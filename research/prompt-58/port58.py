"""prompt-58 portfolio = prompt-57 engine.portfolio (unchanged accounting) with two additions: candidates at the same 5m close
are taken in the given order (best score first) and an optional exposure gate(open_positions, candidate) -> bool."""
import inspect, sys
sys.path.insert(0, '../prompt-57'); import engine as e
src = inspect.getsource(e.portfolio)
src = src.replace("def portfolio(lab, sigs, k, t0, t1, wallet0=1000.0, close_at=None):", "def portfolio(lab, sigs, k, t0, t1, wallet0=1000.0, close_at=None, gate=None):")
src = src.replace("key=lambda x: (x[0], x[1]))", "key=lambda x: x[0])")
src = src.replace("        if len(openp) >= SLOTS: skipped['ALL_SLOTS_IN_USE'] += 1; continue",
                  "        if len(openp) >= SLOTS: skipped['ALL_SLOTS_IN_USE'] += 1; continue\n        if gate is not None and not gate(openp, r): skipped['EXPOSURE_GATE'] = skipped.get('EXPOSURE_GATE', 0) + 1; continue")
assert src.count('gate(openp') == 1 and "key=lambda x: x[0])" in src
ns = dict(e.__dict__); exec(src, ns); portfolio = ns['portfolio']
def k_for(a_pct): return a_pct / 100 * e.LEV + 2 * e.FEE * e.LEV   # emergency trigger ~ a% adverse price move
