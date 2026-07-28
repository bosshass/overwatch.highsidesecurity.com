#!/usr/bin/env python3
"""
Jovelin — cross-component state check

Catches state declared in one component and referenced in another. That
combination builds cleanly and only fails at runtime, on whichever screen
happens to use it, for whichever role reaches that screen — which is how it
twice reached production here (mySession, then staffEmail). Both times the
cause was the same: an edit anchored on a line that exists in more than one
component, landing the declaration in the wrong one.

Run before pushing changes to any view:  python3 scripts/check-component-state.py

Expect false positives for props and for words that appear in JSX text; the
signal is a NEW name appearing after an edit.
"""
import re, sys, glob

def scan(path):
    src = open(path).read()
    lines = src.split("\n")
    bounds = []
    for i, ln in enumerate(lines):
        m = re.match(r'(?:export default )?function (\w+)\(', ln)
        if m: bounds.append((i, m.group(1), ln))
    if not bounds: return []
    bounds.append((len(lines), 'EOF', ''))

    problems = []
    for j in range(len(bounds) - 1):
        a, comp, sig = bounds[j][0], bounds[j][1], bounds[j][2]
        b = bounds[j+1][0]
        body = "\n".join(lines[a:b])
        declared = set(re.findall(r'const \[(\w+),', body))
        for k in range(len(bounds) - 1):
            if k == j: continue
            c, other, osig = bounds[k][0], bounds[k][1], bounds[k][2]
            d = bounds[k+1][0]
            obody = "\n".join(lines[c:d])
            oprops = osig  # props appear in the signature line
            for v in declared:
                if not re.search(r'\b' + v + r'\b', obody): continue
                if re.search(r'const \[' + v + r',', obody): continue   # own state
                if re.search(r'\b' + v + r'\b', oprops): continue        # passed as a prop
                problems.append(f"{path}: '{v}' declared in {comp}, used in {other}")
    return sorted(set(problems))

all_problems = []
for f in sorted(glob.glob("src/views/*.jsx") + glob.glob("src/components/*.jsx") + glob.glob("src/context/*.jsx")):
    all_problems += scan(f)

if all_problems:
    print("POTENTIAL CROSS-COMPONENT STATE REFERENCES:")
    print("\n".join(all_problems))
    sys.exit(1)
print("✓ clean — no state used outside the component that declares it")
