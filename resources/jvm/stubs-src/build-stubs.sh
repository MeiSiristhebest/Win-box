#!/usr/bin/env bash
# 重建 stubs.jar —— 桌面 JVM 桥的 Android/com.catvod 仿真类。
#
# 背景：jar(dex) 蜘蛛经 dex2jar 转换后要在桌面 JRE 上运行，需要 android.* /
# com.github.catvod.* 的桩类。这些桩类必须比"能编译"更严格——还必须
# **字段/方法签名完整**，否则蜘蛛运行期抛 NoSuchFieldError / NoSuchMethodError
# （类比 ClassNotFoundException 更隐蔽）。
#
# ★ 本机（Git Bash on Windows）注意：
#   - javac/jar 是 Windows 原生程序，收到的路径必须是 Windows 风格。
#     MSYS 会把 `/c/...` 转成 `C:\...`，但会把 `@/tmp/files.txt` 里的
#     POSIX 路径原样传过去导致"找不到文件"。因此这里全部用 Windows 路径。
#   - mktemp -d 生成的 /tmp/... 也会被 MSYS 误转换，故改用固定临时目录。
#   - 编译必须带 -sourcepath（本次新增的 SQLiteDatabase ↔ DatabaseErrorHandler
#     互相引用，仅靠 -cp 基线 jar 无法解析）。
#
# 用法：bash build-stubs.sh <javac路径> <jar路径> <基线目录> <输出.jar>
#   基线目录 = 含 stubs.jar 的历史 jar 所在目录（保留其 com.github.catvod.* 等）
set -e
JAVAC="${1:?javac path}"
JAR="${2:?jar path}"
BASE="${3:-.}"
OUT="${4:-stubs.jar}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# 统一转成 Windows 风格路径（cygpath 在 Git Bash 中可用）
win() { cygpath -w "$1" 2>/dev/null || echo "$1"; }
W_HERE="$(win "$HERE")"
W_BASE="$(win "$BASE")"
W_OUT="$(win "$OUT")"

WORK="$(mktemp -d "${TEMP:-/tmp}/stubwork.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT
W_WORK="$(win "$WORK")"

# 1) 解开基线 jar（保留其中的 com.github.catvod.* 等非本目录类）
cp "$BASE/stubs.jar" "$WORK/base.jar"
( cd "$WORK" && "$JAR" xf base.jar )
rm "$WORK/base.jar"
rm -f "$WORK/com/github/catvod/spider/DexNative.class"
# Record resources before compiler lists are added; do not drop non-class assets.
( cd "$WORK" && find . -type f ) > "$WORK/baseline.txt"

# 2) 编译本目录全部 android.* / androidx.* / com.github.catvod.* 源码
#    -cp    指向基线解包目录（历史类）+ libs（gson/okhttp/jsoup/json）
#    -sourcepath 指向源码根（同包互引解析）
#    ★ 文件清单必须写**绝对 Windows 路径**：javac 是原生程序，配合 -sourcepath
#      用相对路径会解析到 -sourcepath + 相对路径，导致"找不到文件"。
#    ★ libs 必须上 classpath：SpiderApi/PushAgent 依赖 gson + okhttp + jsoup，
#      缺失会在编译期报"程序包 com.google.gson 不存在"。
WIN_LIBS=""
for j in "$HERE/../libs"/*.jar; do
    [ -e "$j" ] || continue
    WIN_LIBS="$WIN_LIBS$(win "$j");"
done
find "$HERE" -path '*/shell-shim' -prune -o -name '*.java' -print |
    while read -r f; do printf '"%s"\n' "$(win "$f" | tr '\\' '/')"; done > "$WORK/files.txt"

# SpiderRunner 是**宿主侧运行器**（等效 DexClassLoader 的调用入口），与 stub 类同处
# 一个 jar。它必须每次一起重编：initApi(SpiderApi) 的注入逻辑就在这里，
# 漏编会让新增的 SpiderApi 永远送不到蜘蛛手里（蜘蛛字段为 null → 内部 NPE）。
RUNNER="$HERE/../SpiderRunner.java"
if [ -f "$RUNNER" ]; then
    printf '"%s"\n' "$(win "$RUNNER" | tr '\\' '/')" >> "$WORK/files.txt"
fi

# PythonRunner 是 .py 蜘蛛（Jython）的宿主入口。它 import org.python.*，编译期
# 依赖 libs/ 下的 jython-standalone*.jar；仅当该 jar 存在时编入，否则跳过
# （运行时 .py 源会降级为「Jython 未安装」提示，不影响普通 jar 蜘蛛）。
if ls "$HERE"/../libs/jython-standalone*.jar >/dev/null 2>&1; then
    PYRUNNER="$HERE/../PythonRunner.java"
    if [ -f "$PYRUNNER" ]; then
        printf '"%s"\n' "$(win "$PYRUNNER" | tr '\\' '/')" >> "$WORK/files.txt"
    fi
fi

"$JAVAC" --release 17 -encoding UTF-8 -nowarn \
    -cp "$W_WORK;$WIN_LIBS" \
    -sourcepath "$W_HERE" \
    -d "$W_WORK" \
    @"$W_WORK/files.txt"

# 3) 重新打包：基线资源 + 编译类的显式清单，不混入构建列表或临时 JAR。
TMPOUT="$WORK/out.jar"
( cat "$WORK/baseline.txt"; cd "$WORK" && find . -name '*.class' -type f ) |
    sort -u | while read -r f; do printf '"%s"\n' "$f"; done > "$WORK/pack.txt"
( cd "$WORK" && "$JAR" cf "$(win "$TMPOUT")" @"$(win "$WORK/pack.txt")" )
cp "$TMPOUT" "$OUT"
echo "built $OUT ($(cd "$WORK" && find . -name '*.class' | wc -l) classes)"
