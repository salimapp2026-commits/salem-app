#!/usr/bin/env python3
"""Port screens from the Expo app (repo root) into the bare RN app (native/src).

    python3 native/scripts/port.py app/(auth)/sign-in.tsx app/index.tsx ...

For each given file it follows the `@/...` imports, copies every file that
isn't in native/src yet to the same relative path (app/x.tsx -> src/app/x.tsx,
lib/x.ts -> src/lib/x.ts …) so `@/` imports keep working, and rewrites Expo
imports to their bare React Native replacements. Files that already exist in
native/src are NEVER overwritten (they may have been adapted by hand); pass
--force to re-copy. Anything it can't rewrite automatically is listed at the
end so it gets fixed by hand.
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'native', 'src')
EXTS = ['.tsx', '.ts', '/index.tsx', '/index.ts']

REWRITES = [
    (r"from 'expo-router'", "from '@/navigation/router'"),
    (r"import \{ Feather \} from '@expo/vector-icons';", "import { Feather } from '@react-native-vector-icons/feather';"),
    (r"import \{ Ionicons \} from '@expo/vector-icons';", "import { Ionicons } from '@react-native-vector-icons/ionicons';"),
    (r"import \{ Feather, Ionicons \} from '@expo/vector-icons';",
     "import { Feather } from '@react-native-vector-icons/feather';\nimport { Ionicons } from '@react-native-vector-icons/ionicons';"),
    (r"import \{ StatusBar \} from 'expo-status-bar';", "import { StatusBar } from 'react-native';"),
    (r"from 'expo-localization'", "from 'react-native-localize'"),
]
# Still needs a hand-made change after porting:
MANUAL = re.compile(r"expo-|@expo/|Platform\.OS === 'web'|window\.|document\.|typeof Feather\.glyphMap")


def resolve(spec):
    base = os.path.join(ROOT, spec[2:])
    for e in [''] + EXTS:
        if os.path.isfile(base + e):
            return base + e
    return None


def dest_for(src):
    return os.path.join(SRC, os.path.relpath(src, ROOT))


def port(files, force=False):
    todo = [os.path.join(ROOT, f) for f in files]
    seen, copied, notes = set(), [], []
    while todo:
        f = todo.pop()
        if f in seen or not os.path.isfile(f):
            continue
        seen.add(f)
        text = open(f, encoding='utf-8').read()
        for spec in re.findall(r"from '(@/[^']+)'|import\('(@/[^']+)'\)|require\('(@/[^']+)'\)", text):
            s = next(x for x in spec if x)
            r = resolve(s)
            if r and r.endswith(('.ts', '.tsx')):
                todo.append(r)
        d = dest_for(f)
        if os.path.exists(d) and not force:
            continue
        for a, b in REWRITES:
            text = re.sub(a, b, text)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        open(d, 'w', encoding='utf-8').write(text)
        copied.append(os.path.relpath(d, ROOT))
        for i, line in enumerate(text.split('\n'), 1):
            if MANUAL.search(line) and not line.strip().startswith('//'):
                notes.append(f'{os.path.relpath(d, ROOT)}:{i}: {line.strip()[:110]}')
    for c in sorted(copied):
        print('copied', c)
    if notes:
        print('\nneeds a hand change:')
        for n in notes:
            print('  ', n)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--force']
    port(args, force='--force' in sys.argv)
