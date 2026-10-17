#!/usr/bin/env python3
"""Fail unless this host can bind an IPv6 loopback socket for TLS tests."""

import socket


with socket.socket(socket.AF_INET6, socket.SOCK_STREAM) as listener:
    listener.bind(("::1", 0))

print("PASS: AF_INET6 loopback is available for the release-node TLS suite")
