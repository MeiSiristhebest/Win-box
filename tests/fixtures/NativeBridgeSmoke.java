import com.winbox.nativebridge.BridgeARM32Emulator;
import com.winbox.nativebridge.NativeBridge;
import com.github.unidbg.AndroidEmulator;
import com.github.unidbg.arm.backend.Unicorn2Factory;
import com.github.unidbg.arm.backend.DynarmicFactory;
import com.github.unidbg.linux.android.AndroidEmulatorBuilder;
import com.sun.jna.Pointer;
import com.github.unidbg.pointer.UnidbgPointer;
import unicorn.ArmConst;
import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.List;

public final class NativeBridgeSmoke {
    private static int assertions;
    private static void equal(long actual, long expected, String message) {
        assertions++;
        if (actual != expected) throw new AssertionError(message + ": " + actual + " != " + expected);
    }
    private static int syscall(BridgeARM32Emulator emulator, Pointer code, int number, Number... args) {
        emulator.getBackend().reg_write(ArmConst.UC_ARM_REG_R7, number);
        Number[] registers = new Number[args.length];
        for (int i = 0; i < args.length; i++) registers[i] = args[i].intValue();
        return emulator.eFunc(UnidbgPointer.nativeValue(code), registers).intValue();
    }
    private static void nativeReturnTypeContract() throws Exception {
        Method requireSupportedReturnType = NativeBridge.class.getDeclaredMethod("requireSupportedReturnType", String.class);
        requireSupportedReturnType.setAccessible(true);
        String[] descriptors = {
                "()V", "()Z", "()I", "()S", "()B", "()C", "()J", "()Ljava/lang/String;", "()[B"
        };
        char[] expected = {'V', 'Z', 'I', 'S', 'B', 'C', 'J', 'L', '['};
        for (int i = 0; i < descriptors.length; i++) {
            char actual = (Character) requireSupportedReturnType.invoke(null, descriptors[i]);
            equal(actual, expected[i], "supported JNI return descriptor " + descriptors[i]);
        }
        for (String descriptor : new String[] {"()F", "()D"}) {
            try {
                requireSupportedReturnType.invoke(null, descriptor);
                throw new AssertionError("unsupported JNI return descriptor accepted: " + descriptor);
            } catch (InvocationTargetException wrapped) {
                Throwable cause = wrapped.getCause();
                if (!(cause instanceof UnsupportedOperationException) || !cause.getMessage().contains(descriptor)) {
                    throw new AssertionError("missing unsupported return diagnostic for " + descriptor, cause);
                }
                assertions++;
            }
        }
    }
    private static byte[] elfHeader(int elfClass, int machine) {
        byte[] header = new byte[20];
        header[0] = 0x7f;
        header[1] = 'E';
        header[2] = 'L';
        header[3] = 'F';
        header[4] = (byte) elfClass;
        header[5] = 1;
        header[18] = (byte) machine;
        header[19] = (byte) (machine >>> 8);
        return header;
    }
    private static void nativeArchitectureContract(File root) throws Exception {
        Method elfBits = NativeBridge.class.getDeclaredMethod("elfBits", byte[].class);
        elfBits.setAccessible(true);
        equal((Integer) elfBits.invoke(null, (Object) elfHeader(1, 0x28)), 32, "ARM32 ELF recognition");
        equal((Integer) elfBits.invoke(null, (Object) elfHeader(2, 0xb7)), 64, "AArch64 ELF recognition");
        equal((Integer) elfBits.invoke(null, (Object) elfHeader(2, 0x3e)), 0, "x86_64 ELF rejection");
        equal((Integer) elfBits.invoke(null, (Object) new byte[8]), 0, "truncated ELF rejection");
        equal((Integer) elfBits.invoke(null, (Object) new byte[20]), 0, "non-ELF rejection");

        Method detectArchBits = NativeBridge.class.getDeclaredMethod("detectArchBits", File.class);
        detectArchBits.setAccessible(true);
        File unsupportedSo = new File(root, "unsupported-x86_64.so");
        java.nio.file.Files.write(unsupportedSo.toPath(), elfHeader(2, 0x3e));
        try {
            detectArchBits.invoke(null, unsupportedSo);
            throw new AssertionError("unsupported native architecture accepted");
        } catch (InvocationTargetException wrapped) {
            Throwable cause = wrapped.getCause();
            if (!(cause instanceof IllegalStateException)
                    || !cause.getMessage().contains("架构不受支持")
                    || !cause.getMessage().contains(unsupportedSo.getName())) {
                throw new AssertionError("missing unsupported native architecture diagnostic", cause);
            }
            assertions++;
        }
    }
    public static void main(String[] args) throws Exception {
        if (!NativeBridge.available()) throw new AssertionError("Native bridge unavailable");
        File root = new File(args[0]);
        nativeReturnTypeContract();
        nativeArchitectureContract(root);
        try (BridgeARM32Emulator emulator = new BridgeARM32Emulator("winbox-native-check", new File(root, "arm32"), List.of(new Unicorn2Factory(true)))) {
            Pointer memory = emulator.getMemory().mmap(4096, 7);
            memory.write(0, new byte[] {42, 0, (byte)0xa0, (byte)0xe3, 30, (byte)0xff, 47, (byte)0xe1}, 0, 8);
            equal(emulator.eFunc(UnidbgPointer.nativeValue(memory)).intValue(), 42, "ARM32 execution");
            Pointer code = memory.share(16);
            code.write(0, new byte[] {0, 0, 0, (byte)0xef, 30, (byte)0xff, 47, (byte)0xe1}, 0, 8);
            Pointer value = memory.share(128), event = memory.share(160), result = memory.share(192);
            int counter = syscall(emulator, code, 356, 3, 2048);
            if (counter < 0) throw new AssertionError("eventfd2: " + counter);
            equal(syscall(emulator, code, 3, counter, UnidbgPointer.nativeValue(value), 8), 8, "initial eventfd read");
            equal(value.getLong(0), 3, "eventfd initial counter");
            equal(syscall(emulator, code, 3, counter, UnidbgPointer.nativeValue(value), 8), -11, "empty eventfd EAGAIN");
            int poll = syscall(emulator, code, 357, 0);
            if (poll < 0) throw new AssertionError("epoll_create1: " + poll);
            event.setInt(0, 1 | 0x40000000);
            event.setLong(8, 0x1122334455667788L);
            equal(syscall(emulator, code, 251, poll, 1, counter, UnidbgPointer.nativeValue(event)), 0, "epoll add");
            equal(syscall(emulator, code, 251, poll, 1, counter, UnidbgPointer.nativeValue(event)), -17, "epoll duplicate EEXIST");
            equal(syscall(emulator, code, 252, poll, UnidbgPointer.nativeValue(result), 1, 0), 0, "drained eventfd not ready");
            value.setLong(0, 9);
            equal(syscall(emulator, code, 4, counter, UnidbgPointer.nativeValue(value), 8), 8, "eventfd write");
            equal(syscall(emulator, code, 252, poll, UnidbgPointer.nativeValue(result), 1, 0), 1, "epoll ready count");
            equal(result.getInt(0), 1, "epoll events");
            equal(result.getLong(8), 0x1122334455667788L, "ARM epoll data layout");
            equal(syscall(emulator, code, 252, poll, UnidbgPointer.nativeValue(result), 1, 0), 0, "EPOLLONESHOT");
            event.setInt(0, 1);
            equal(syscall(emulator, code, 251, poll, 3, counter, UnidbgPointer.nativeValue(event)), 0, "epoll rearm");
            equal(syscall(emulator, code, 63, counter, 99), 99, "eventfd duplicate descriptor");
            equal(syscall(emulator, code, 6, counter), 0, "original descriptor close");
            equal(syscall(emulator, code, 252, poll, UnidbgPointer.nativeValue(result), 1, 0), 1, "registration survives a live duplicate");
            equal(syscall(emulator, code, 3, 99, UnidbgPointer.nativeValue(value), 8), 8, "read duplicate");
            equal(value.getLong(0), 9, "shared counter value");
            equal(syscall(emulator, code, 252, poll, UnidbgPointer.nativeValue(result), 1, 0), 0, "duplicate drained");
            equal(syscall(emulator, code, 6, 99), 0, "last duplicate close");
            equal(syscall(emulator, code, 252, poll, UnidbgPointer.nativeValue(result), 1, 0), 0, "closed counter pruned");
        }
        try (AndroidEmulator emulator = AndroidEmulatorBuilder.for64Bit().setProcessName("winbox-native-check64").setRootDir(new File(root, "arm64")).addBackendFactory(new DynarmicFactory(true)).build()) {
            Pointer code = emulator.getMemory().mmap(4096, 7);
            code.write(0, new byte[] {64, 5, (byte)0x80, (byte)0xd2, (byte)0xc0, 3, 95, (byte)0xd6}, 0, 8);
            equal(emulator.eFunc(UnidbgPointer.nativeValue(code)).intValue(), 42, "AArch64 execution with Dynarmic");
        }
        System.out.println("Native bridge runtime passed: " + assertions + " assertions");
    }
}
