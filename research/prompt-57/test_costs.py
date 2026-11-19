"""Checks the cost/target rules the study depends on (75x, +25% net margin, 0.05% fee, 0.02% slippage). Run: python3 test_costs.py"""
import engine as e
def test_target_needs_0_474_percent_market_move():
    open_px = 100.0; E = open_px * (1 + e.SLIP); T = e.target_trigger(E, 1)
    assert abs((T / open_px - 1) * 100 - 0.474) < 0.001
def test_target_is_exactly_25_percent_of_margin_after_costs():
    E = 100.0; X = e.target_trigger(E, 1) * (1 - e.SLIP); q = 1.0
    net = q * (X - E) - e.FEE * q * (E + X); margin = q * E / 75
    assert abs(net / margin - 0.25) < 1e-9
    Es = 100.0; Xs = e.target_trigger(Es, -1) * (1 + e.SLIP); nets = q * (Es - Xs) - e.FEE * q * (Es + Xs)
    assert abs(nets / (q * Es / 75) - 0.25) < 1e-9
def test_emergency_two_x_margin_is_about_2_6_percent_against():
    assert abs((1 - e.emergency_trigger(100.0, 1, 2.0) / 100) * 100 - 2.568) < 0.01
if __name__ == '__main__':
    for n, f in list(globals().items()):
        if n.startswith('test_'): f(); print('pass', n)
