#!/usr/bin/env bash
# Run an Android build command with JDK 17 and the Android SDK, for this one
# command only. Nothing is written to your shell profile, and Android Studio
# keeps its own bundled JDK.
#
# React Native 0.81's Gradle needs JDK 17 (Android Studio 2026.x bundles JDK 25,
# which this Gradle can't run on).
#
# Usage (from native/):
#   scripts/android.sh                        # build + install on the running emulator
#   scripts/android.sh run-android --no-packager
#   scripts/android.sh gradle assembleDebug   # any Gradle task, run in android/
set -euo pipefail

cd "$(dirname "$0")/.."

JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
if [[ -z "$JAVA_HOME" ]]; then
  echo "JDK 17 not found. Expected under ~/Library/Java/JavaVirtualMachines." >&2
  exit 1
fi
export JAVA_HOME

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [[ ! -d "$ANDROID_HOME/platform-tools" ]]; then
  echo "Android SDK not found at $ANDROID_HOME. Finish the Android Studio setup wizard first." >&2
  exit 1
fi
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

case "${1:-run-android}" in
  gradle)
    shift
    cd android && exec ./gradlew "$@"
    ;;
  *)
    exec npx react-native "${@:-run-android}"
    ;;
esac
