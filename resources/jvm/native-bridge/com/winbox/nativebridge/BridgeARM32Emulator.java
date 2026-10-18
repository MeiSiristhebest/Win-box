package com.winbox.nativebridge;

import com.github.unidbg.Emulator;
import com.github.unidbg.arm.backend.BackendFactory;
import com.github.unidbg.arm.backend.Backend;
import com.github.unidbg.arm.context.RegisterContext;
import com.github.unidbg.arm.context.Arm32RegisterContext;
import com.github.unidbg.file.linux.AndroidFileIO;
import com.github.unidbg.file.FileIO;
import com.github.unidbg.file.linux.BaseAndroidFileIO;
import com.github.unidbg.file.linux.IOConstants;
import com.github.unidbg.file.FileResult;
import com.github.unidbg.linux.file.ByteArrayFileIO;
import com.github.unidbg.linux.ARM32SyscallHandler;
import com.github.unidbg.linux.AndroidSyscallHandler;
import com.github.unidbg.linux.android.AndroidARMEmulator;
import com.github.unidbg.linux.signal.SigAction;
import com.github.unidbg.linux.thread.AndroidWaiter;
import com.github.unidbg.memory.SvcMemory;
import com.github.unidbg.signal.SignalOps;
import com.github.unidbg.signal.SigSet;
import com.github.unidbg.signal.UnixSigSet;
import com.github.unidbg.signal.SignalTask;
import com.github.unidbg.thread.RunnableTask;
import com.github.unidbg.thread.Task;
import com.github.unidbg.thread.ThreadContextSwitchException;
import com.github.unidbg.unix.UnixSyscallHandler;
import com.sun.jna.Pointer;
import unicorn.ArmConst;

import java.io.File;
import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.Iterator;

/** ARM32 kernel ABI used by Go's direct syscalls, not bionic's legacy ABI. */
public final class BridgeARM32Emulator extends AndroidARMEmulator {
    public BridgeARM32Emulator(String processName, File root, Collection<BackendFactory> backends) {
        super(processName, root, backends);
        // c-shared Go cannot see an exec-time aux vector. Without this file it
        // falls back to unsupported mincore and guesses 256 KiB pages, whereas
        // our mmap allocator actually uses getPageAlign() (4 KiB).
        getSyscallHandler().addIOResolver((emulator, pathname, flags) -> {
            if (!"/proc/self/auxv".equals(pathname)) return null;
            if ((flags & 3) != 0) return FileResult.failed(13); // EACCES
            byte[] vector = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)
                    .putInt(6).putInt(getPageAlign()).putInt(0).putInt(0).array(); // AT_PAGESZ, AT_NULL
            return FileResult.success(new ByteArrayFileIO(flags, pathname, vector));
        });
    }

    @Override protected UnixSyscallHandler<AndroidFileIO> createSyscallHandler(SvcMemory svc) {
        return new Signals(svc);
    }

    @Override protected com.github.unidbg.file.FileSystem<AndroidFileIO> createFileSystem(File root) {
        return new BridgeFileSystem(this, root);
    }

    static final class Signals extends ARM32SyscallHandler {
        private final Map<Integer, SigAction> actions;

        @SuppressWarnings("unchecked")
        Signals(SvcMemory svc) {
            super(svc);
            // unidbg 0.9.9 has no protected registration API. Share its actual registry
            // so kill/tgkill/emulateSignal use these handlers too; never report a no-op.
            try {
                Field field = AndroidSyscallHandler.class.getDeclaredField("sigActionMap");
                field.setAccessible(true);
                actions = (Map<Integer, SigAction>) field.get(this);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException("unidbg signal registry unavailable", e);
            }
        }

        @Override protected boolean handleSyscall(Emulator<?> emulator, int number) {
            int result;
            if (number == 174) result = rtSigaction(emulator);
            else if (number == 175) result = rtSigprocmask(emulator);
            else if (number == 162) result = kernelNanosleep(emulator);
            else if (number == 356) result = kernelEventfd(emulator);
            else if ((number == 55 || number == 221) && fdMap.get(emulator.getContext().getIntArg(0)) instanceof PollFile) {
                RegisterContext ctx = emulator.getContext();
                result = fdMap.get(ctx.getIntArg(0)).fcntl(emulator, ctx.getIntArg(1), Integer.toUnsignedLong(ctx.getIntArg(2)));
            }
            else if ((number == 3 || number == 4 || number == 55 || number == 221)
                    && fdMap.get(emulator.getContext().getIntArg(0)) instanceof CounterFile) {
                RegisterContext ctx = emulator.getContext();
                CounterFile file = (CounterFile) fdMap.get(ctx.getIntArg(0));
                if (number == 3) result = file.read(emulator.getBackend(), ctx.getPointerArg(1), ctx.getIntArg(2));
                else if (number == 4) result = file.writePointer(ctx.getPointerArg(1), ctx.getIntArg(2));
                else result = file.fcntl(emulator, ctx.getIntArg(1), Integer.toUnsignedLong(ctx.getIntArg(2)));
            }
            else if (number == 250 || number == 357) result = kernelEpollCreate(emulator, number == 357);
            else if (number == 251) result = kernelEpollControl(emulator);
            else if (number == 252 || number == 346 || number == 441) result = kernelEpollWait(emulator, number);
            else return super.handleSyscall(emulator, number);
            emulator.getBackend().reg_write(ArmConst.UC_ARM_REG_R0, result);
            return true;
        }

        private int kernelEventfd(Emulator<?> emulator) {
            RegisterContext ctx = emulator.getContext();
            int flags = ctx.getIntArg(1);
            if ((flags & ~(1 | IOConstants.O_NONBLOCK | IOConstants.O_CLOEXEC)) != 0) return -22;
            return addFileIO(new CounterFile(emulator, Integer.toUnsignedLong(ctx.getIntArg(0)), flags));
        }

        private int kernelEpollCreate(Emulator<?> emulator, boolean flagsCall) {
            int value = emulator.getContext().getIntArg(0);
            if (flagsCall ? (value & ~IOConstants.O_CLOEXEC) != 0 : value <= 0) return -22;
            return addFileIO(new PollFile(flagsCall && (value & IOConstants.O_CLOEXEC) != 0));
        }

        private int kernelEpollControl(Emulator<?> emulator) {
            RegisterContext ctx = emulator.getContext();
            AndroidFileIO descriptor = fdMap.get(ctx.getIntArg(0)), target = fdMap.get(ctx.getIntArg(2));
            if (descriptor == null || target == null) return -9;
            if (!(descriptor instanceof PollFile) || descriptor == target) return -22;
            int operation = ctx.getIntArg(1), fd = ctx.getIntArg(2);
            if (operation < 1 || operation > 3) return -22;
            if (!(target instanceof CounterFile)) return -95; // EOPNOTSUPP
            PollFile poll = (PollFile) descriptor;
            poll.prune();
            CounterFile counter = (CounterFile) target;
            RegistrationKey key = new RegistrationKey(fd, counter.state);
            Registration previous = poll.registrations.get(key);
            if (operation == 1 && previous != null) return -17; // EEXIST
            if (operation != 1 && previous == null) return -2; // ENOENT
            if (operation == 2) { poll.registrations.remove(key); return 0; }
            Pointer event = ctx.getPointerArg(3);
            if (event == null) return -14;
            int mask = event.getInt(0);
            if ((mask & ~(1 | 4 | 8 | 16 | 0x40000000 | 0x80000000)) != 0) return -95;
            poll.registrations.put(key, new Registration(counter, mask, event.getLong(8)));
            return 0;
        }

        private int kernelEpollWait(Emulator<?> emulator, int number) {
            RegisterContext ctx = emulator.getContext();
            AndroidFileIO descriptor = fdMap.get(ctx.getIntArg(0));
            if (descriptor == null) return -9;
            if (!(descriptor instanceof PollFile)) return -22;
            Pointer events = ctx.getPointerArg(1);
            int maximum = ctx.getIntArg(2);
            if (maximum <= 0 || maximum > Integer.MAX_VALUE / 16) return -22;
            if (events == null) return -14;
            // Linux syscall arguments 5/6 are R4/R5, NOT AAPCS stack arguments.
            Arm32RegisterContext arm = emulator.getContext();
            if (number != 252 && arm.getR4Pointer() != null) {
                if (arm.getR5Int() != 8) return -22;
                return -95; // temporary signal mask not implemented; do not ignore it
            }
            final long duration;
            if (number == 441) {
                Pointer timespec = ctx.getPointerArg(3);
                if (timespec == null) duration = -1;
                else {
                    long seconds = timespec.getLong(0), nanos = timespec.getLong(8);
                    if (seconds < 0 || nanos < 0 || nanos >= 1_000_000_000L) return -22;
                    duration = seconds > (Long.MAX_VALUE - nanos) / 1_000_000_000L ? Long.MAX_VALUE : seconds * 1_000_000_000L + nanos;
                }
            } else duration = ctx.getIntArg(3) < 0 ? -1 : ctx.getIntArg(3) * 1_000_000L;
            PollFile poll = (PollFile) descriptor;
            int ready = poll.collect(events, maximum, true);
            if (ready != 0 || duration == 0) return ready;
            RunnableTask task = emulator.getThreadDispatcher().getRunningTask();
            if (!threadDispatcherEnabled || task == null) throw new UnsupportedOperationException("Blocking epoll requires the emulated thread dispatcher");
            task.setWaiter(emulator, new AndroidWaiter() {
                private final long started = System.nanoTime();
                private boolean interrupted;
                @Override public boolean canDispatch() {
                    boolean ready = interrupted || poll.collect(null, maximum, false) != 0 || (duration >= 0 && System.nanoTime() - started >= duration);
                    if (!ready) Thread.yield();
                    return ready;
                }
                @Override public void onSignal(SignalTask signal) { super.onSignal(signal); interrupted = true; }
                @Override public void onContinueRun(Emulator<?> e) {
                    e.getBackend().reg_write(ArmConst.UC_ARM_REG_R0, interrupted ? -4 : poll.collect(events, maximum, true));
                }
            });
            throw new ThreadContextSwitchException().setReturnValue(0);
        }

        private static final class Registration {
            final CounterFile file;
            final int mask;
            final long data;
            long readEpoch = -1, writeEpoch = -1;
            boolean disabled;
            Registration(CounterFile file, int mask, long data) { this.file = file; this.mask = mask; this.data = data; }
            int ready() {
                if (disabled) return 0;
                boolean edge = (mask & 0x80000000) != 0;
                int bits = 0;
                boolean readable = file.canRead();
                boolean writable = file.state.value != CounterFile.MAX;
                long readNow = file.state.readEpoch;
                long writeNow = file.state.writeEpoch;
                if ((mask & 1) != 0 && readable && (!edge || readEpoch != readNow)) bits |= 1;
                if ((mask & 4) != 0 && writable && (!edge || writeEpoch != writeNow)) bits |= 4;
                return bits;
            }
        }

        private static final class RegistrationKey {
            final int fd;
            final CounterFile.State state;
            RegistrationKey(int fd, CounterFile.State state) { this.fd = fd; this.state = state; }
            @Override public int hashCode() { return 31 * fd + System.identityHashCode(state); }
            @Override public boolean equals(Object other) {
                return other instanceof RegistrationKey && ((RegistrationKey) other).fd == fd && ((RegistrationKey) other).state == state;
            }
        }

        private final class PollFile extends BaseAndroidFileIO {
            private final Map<RegistrationKey, Registration> registrations;
            PollFile(boolean cloexec) { this(new LinkedHashMap<>(), cloexec ? 1 : 0); }
            private PollFile(Map<RegistrationKey, Registration> registrations, int flags) {
                super(IOConstants.O_RDWR); this.registrations = registrations; this.op = flags;
            }
            @Override public String getPath() { return "anon_inode:[eventpoll]"; }
            @Override public void close() { }
            @Override public FileIO dup2() { return new PollFile(registrations, 0); }
            @Override public int fcntl(Emulator<?> e, int cmd, long arg) {
                if (cmd == 1) return op;
                if (cmd == 2) { op = (int) arg & 1; return 0; }
                if (cmd == 3) return IOConstants.O_RDWR;
                return -22;
            }
            void prune() {
                // The kernel keeps a registration until the last descriptor for
                // the open file description closes, even if the registered fd
                // was closed and its number reused while a dup remains alive.
                registrations.entrySet().removeIf(entry -> fdMap.values().stream().noneMatch(file ->
                        file instanceof CounterFile && ((CounterFile) file).state == entry.getValue().file.state));
            }
            int collect(Pointer events, int maximum, boolean consume) {
                prune();
                int count = 0;
                // Rotate delivered entries so maxevents does not starve later level-triggered entries.
                Map<RegistrationKey, Registration> delivered = new LinkedHashMap<>();
                Iterator<Map.Entry<RegistrationKey, Registration>> iterator = registrations.entrySet().iterator();
                while (iterator.hasNext() && count < maximum) {
                    Map.Entry<RegistrationKey, Registration> entry = iterator.next();
                    Registration registration = entry.getValue();
                    int bits = registration.ready();
                    if (bits == 0) continue;
                    if (consume) {
                        events.setInt(count * 16L, bits);
                        events.setInt(count * 16L + 4, 0); // ARM ABI padding, data at offset 8
                        events.setLong(count * 16L + 8, registration.data);
                        registration.readEpoch = registration.file.state.readEpoch;
                        registration.writeEpoch = registration.file.state.writeEpoch;
                        registration.disabled = (registration.mask & 0x40000000) != 0;
                        delivered.put(entry.getKey(), registration);
                        iterator.remove();
                    }
                    count++;
                }
                registrations.putAll(delivered);
                return count;
            }
        }

        /** eventfd is an unsigned 64-bit counter, not an always-ready placeholder.
         * Descriptor flags are private; dup shares the counter and status flags. */
        private final class CounterFile extends BaseAndroidFileIO {
            private static final long MAX = -2L; // UINT64_MAX-1
            private static final class State {
                long value;
                long readEpoch = 1, writeEpoch = 1;
                int flags;
                final boolean semaphore;
                State(long value, int flags) { this.value = value; this.flags = flags & IOConstants.O_NONBLOCK; this.semaphore = (flags & 1) != 0; }
            }
            private final Emulator<?> emulator;
            private final State state;
            CounterFile(Emulator<?> emulator, long initial, int flags) {
                this(emulator, new State(initial, flags), (flags & IOConstants.O_CLOEXEC) != 0 ? 1 : 0);
            }
            private CounterFile(Emulator<?> emulator, State state, int descriptorFlags) {
                super(IOConstants.O_RDWR);
                this.emulator = emulator; this.state = state; this.op = descriptorFlags;
            }
            private int error(int errno) { emulator.getMemory().setErrno(errno); return -errno; }
            @Override public String getPath() { return "anon_inode:[eventfd]"; }
            @Override public void close() { /* Removing a descriptor does not erase its duplicated counter. */ }
            @Override public FileIO dup2() { return new CounterFile(emulator, state, 0); }
            @Override public boolean canRead() { return state.value != 0; }
            @Override protected void setFlags(long flags) { state.flags = (int) flags & IOConstants.O_NONBLOCK; }
            @Override public int fcntl(Emulator<?> e, int cmd, long arg) {
                switch (cmd) {
                    case 1: return op;
                    case 2: op = (int) arg & 1; return 0;
                    case 3: return IOConstants.O_RDWR | state.flags;
                    case 4: setFlags(arg); return 0;
                    default: return error(22);
                }
            }
            @Override public int read(Backend backend, Pointer buffer, int count) {
                if (count < 8) return error(22);
                if (buffer == null) return error(14);
                if (state.value == 0) return waitFor(false, 0, buffer);
                long value = state.semaphore ? 1 : state.value;
                buffer.setLong(0, value);
                state.writeEpoch++;
                state.value -= value;
                return 8;
            }
            int writePointer(Pointer buffer, int count) {
                if (count != 8) return error(22);
                if (buffer == null) return error(14);
                return add(buffer.getLong(0));
            }
            @Override public int write(byte[] data) {
                if (data.length != 8) return error(22);
                return add(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).getLong());
            }
            private boolean hasCapacity(long value) { return Long.compareUnsigned(state.value, MAX - value) <= 0; }
            private int add(long value) {
                if (value == -1L) return error(22);
                if (!hasCapacity(value)) return waitFor(true, value, null);
                state.readEpoch++;
                state.value += value;
                return 8;
            }
            private int waitFor(boolean writing, long value, Pointer buffer) {
                if ((state.flags & IOConstants.O_NONBLOCK) != 0) return error(11);
                RunnableTask task = emulator.getThreadDispatcher().getRunningTask();
                if (!threadDispatcherEnabled || task == null)
                    throw new UnsupportedOperationException("Blocking eventfd requires the emulated thread dispatcher");
                task.setWaiter(emulator, new AndroidWaiter() {
                    private boolean interrupted;
                    @Override public boolean canDispatch() { return interrupted || (writing ? hasCapacity(value) : canRead()); }
                    @Override public void onSignal(SignalTask signal) { super.onSignal(signal); interrupted = true; }
                    @Override public void onContinueRun(Emulator<?> e) {
                        int result = interrupted ? error(4) : writing ? add(value) : read(e.getBackend(), buffer, 8);
                        e.getBackend().reg_write(ArmConst.UC_ARM_REG_R0, result);
                    }
                });
                throw new ThreadContextSwitchException().setReturnValue(0);
            }
        }

        private int rtSigaction(Emulator<?> emulator) {
            RegisterContext context = emulator.getContext();
            int signal = context.getIntArg(0);
            if (context.getIntArg(3) != 8 || signal < 1 || signal > 64) return -22; // EINVAL
            Pointer input = context.getPointerArg(1), output = context.getPointerArg(2);
            if (input != null && (signal == 9 || signal == 19)) return -22; // SIGKILL/SIGSTOP
            // Snapshot before output: act and oldact may alias. A query must NOT erase
            // a registered action (upstream legacy sigaction puts null in its map).
            KernelAction replacement = input == null ? null : new KernelAction(input);
            if (replacement != null) replacement.setMask(replacement.getMask() & ~((1L << 8) | (1L << 18)));
            SigAction previous = actions.get(signal);
            if (output != null) {
                output.setInt(0, previous == null ? 0 : (int) previous.getSaHandler());
                output.setInt(4, previous == null ? 0 : previous.getFlags());
                output.setInt(8, previous == null ? 0 : (int) previous.getSaRestorer());
                output.setLong(12, previous == null ? 0 : previous.getMask());
            }
            if (replacement != null) actions.put(signal, replacement);
            return 0;
        }

        private int kernelNanosleep(Emulator<?> emulator) {
            Pointer request = emulator.getContext().getPointerArg(0);
            if (request == null) return -14; // EFAULT
            int seconds = request.getInt(0), nanos = request.getInt(4);
            if (seconds < 0 || nanos < 0 || nanos >= 1_000_000_000) return -22;
            long duration = seconds * 1_000_000_000L + nanos;
            if (duration == 0) return 0;
            Pointer remainder = emulator.getContext().getPointerArg(1);
            RunnableTask task = emulator.getThreadDispatcher().getRunningTask();
            if (threadDispatcherEnabled && task != null) {
                // Upstream rounds to milliseconds, then rejects sub-ms sleeps.
                // Go uses microsecond sleeps during startup; retain real elapsed
                // time and yield to other emulated tasks instead of a no-op.
                task.setWaiter(emulator, new NanoWaiter(duration, remainder));
                throw new ThreadContextSwitchException().setReturnValue(0);
            }
            long started = System.nanoTime();
            try {
                Thread.sleep(duration / 1_000_000L, (int) (duration % 1_000_000L));
                return 0;
            } catch (InterruptedException e) {
                writeRemainder(remainder, Math.max(0, duration - (System.nanoTime() - started)));
                Thread.currentThread().interrupt();
                return -4; // EINTR
            }
        }

        private static void writeRemainder(Pointer pointer, long nanos) {
            if (pointer != null) {
                pointer.setInt(0, (int) (nanos / 1_000_000_000L));
                pointer.setInt(4, (int) (nanos % 1_000_000_000L));
            }
        }

        private static final class NanoWaiter extends AndroidWaiter {
            private final long started = System.nanoTime(), duration;
            private final Pointer remainder;
            private boolean interrupted;
            NanoWaiter(long duration, Pointer remainder) { this.duration = duration; this.remainder = remainder; }
            @Override public boolean canDispatch() {
                if (interrupted || System.nanoTime() - started >= duration) return true;
                Thread.yield();
                return false;
            }
            @Override public void onSignal(SignalTask signal) {
                super.onSignal(signal);
                interrupted = true;
                writeRemainder(remainder, Math.max(0, duration - (System.nanoTime() - started)));
            }
            @Override public void onContinueRun(Emulator<?> emulator) {
                if (interrupted) emulator.getBackend().reg_write(ArmConst.UC_ARM_REG_R0, -4);
            }
        }

        private int rtSigprocmask(Emulator<?> emulator) {
            RegisterContext context = emulator.getContext();
            if (context.getIntArg(3) != 8) return -22;
            int how = context.getIntArg(0);
            Pointer input = context.getPointerArg(1), output = context.getPointerArg(2);
            if (input != null && (how < 0 || how > 2)) return -22;
            long requested = input == null ? 0 : input.getLong(0);
            // Linux silently excludes signals that cannot be blocked.
            requested &= ~((1L << 8) | (1L << 18));
            Task task = emulator.get(Task.TASK_KEY);
            SignalOps state = task == null || task.isMainThread() ? emulator.getThreadDispatcher() : task;
            SigSet current = state.getSigMaskSet();
            long previous = current == null ? 0 : current.getMask();
            if (output != null) output.setLong(0, previous);
            if (input != null) {
                long next = how == 0 ? previous | requested : how == 1 ? previous & ~requested : requested;
                state.setSigMaskSet(new UnixSigSet(next));
                if (state.getSigPendingSet() == null) state.setSigPendingSet(new UnixSigSet(0));
            }
            return 0;
        }
    }

    /** Linux ARM kernel layout: handler, flags, restorer, 64-bit mask (20 bytes).
     * Int halves deliberately avoid host/JNA long alignment at offset 12. */
    public static final class KernelAction extends SigAction {
        public int handler, flags, restorer, maskLow, maskHigh;
        public KernelAction(Pointer pointer) { super(pointer); unpack(); }
        @Override protected List<String> getFieldOrder() {
            return Arrays.asList("handler", "flags", "restorer", "maskLow", "maskHigh");
        }
        @Override public long getSaHandler() { return Integer.toUnsignedLong(handler); }
        @Override public void setSaHandler(long value) { handler = (int) value; }
        @Override public long getSaRestorer() { return Integer.toUnsignedLong(restorer); }
        @Override public void setSaRestorer(long value) { restorer = (int) value; }
        @Override public int getFlags() { return flags; }
        @Override public void setFlags(int value) { flags = value; }
        @Override public long getMask() { return Integer.toUnsignedLong(maskLow) | ((long) maskHigh << 32); }
        @Override public void setMask(long value) { maskLow = (int) value; maskHigh = (int) (value >>> 32); }
    }
}
