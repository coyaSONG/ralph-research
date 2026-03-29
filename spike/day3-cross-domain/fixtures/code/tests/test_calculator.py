from calculator import add


def test_add_positive_numbers():
    assert add(2, 3) == 5


def test_add_mixed_sign_numbers():
    assert add(-1, 1) == 0
