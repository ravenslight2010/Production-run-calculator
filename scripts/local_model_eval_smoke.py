#!/usr/bin/env python3
"""Run bounded synthetic text and vision checks without retaining model output."""

from __future__ import annotations

import base64
import json
import re
import struct
import threading
import time
import urllib.error
import urllib.request
import zlib
from decimal import Decimal, InvalidOperation

import local_model_eval_proxy as proxy

ENDPOINT = "http://127.0.0.1:11434"
APP_HEALTH = "http://127.0.0.1:8080/api/healthz"
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
REQUEST_TIMEOUT_SECONDS = proxy.REQUEST_DEADLINE_SECONDS + 5


FONT_5X7 = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "C": ("01111", "10000", "10000", "10000", "10000", "10000", "01111"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "F": ("11111", "10000", "10000", "11110", "10000", "10000", "10000"),
    "G": ("01111", "10000", "10000", "10111", "10001", "10001", "01111"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "J": ("00111", "00010", "00010", "00010", "10010", "10010", "01100"),
    "K": ("10001", "10010", "10100", "11000", "10100", "10010", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "Q": ("01110", "10001", "10001", "10001", "10101", "10010", "01101"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "V": ("10001", "10001", "10001", "10001", "10001", "01010", "00100"),
    "W": ("10001", "10001", "10001", "10101", "10101", "10101", "01010"),
    "X": ("10001", "10001", "01010", "00100", "01010", "10001", "10001"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "Z": ("11111", "00001", "00010", "00100", "01000", "10000", "11111"),
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "3": ("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
    "4": ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    "5": ("11111", "10000", "10000", "11110", "00001", "00001", "11110"),
    "6": ("01110", "10000", "10000", "11110", "10001", "10001", "01110"),
    "7": ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    "8": ("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
    "9": ("01110", "10001", "10001", "01111", "00001", "00001", "01110"),
    ".": ("00000", "00000", "00000", "00000", "00000", "00110", "00110"),
    "/": ("00001", "00010", "00010", "00100", "01000", "01000", "10000"),
}


def _png_synthetic_spec() -> bytes:
    width, height, scale = 900, 390, 4
    pixels = bytearray([255, 255, 255] * width * height)

    def pixel(x: int, y: int, color: tuple[int, int, int] = (20, 25, 30)) -> None:
        if 0 <= x < width and 0 <= y < height:
            offset = (y * width + x) * 3
            pixels[offset : offset + 3] = bytes(color)

    def line(x1: int, y1: int, x2: int, y2: int) -> None:
        if x1 == x2:
            for y in range(y1, y2 + 1):
                pixel(x1, y)
                pixel(x1 + 1, y)
        elif y1 == y2:
            for x in range(x1, x2 + 1):
                pixel(x, y1)
                pixel(x, y1 + 1)

    def draw_text(x: int, y: int, value: str) -> None:
        cursor = x
        for char in value:
            if char == " ":
                cursor += 7 * scale
                continue
            glyph = FONT_5X7[char]
            for row_index, row in enumerate(glyph):
                for column_index, bit in enumerate(row):
                    if bit == "1":
                        for dy in range(scale):
                            for dx in range(scale):
                                pixel(
                                    cursor + column_index * scale + dx,
                                    y + row_index * scale + dy,
                                )
            cursor += 7 * scale

    line(40, 35, 860, 35)
    line(40, 95, 860, 95)
    line(40, 165, 860, 165)
    line(40, 230, 860, 230)
    line(40, 295, 860, 295)
    line(40, 360, 860, 360)
    line(620, 95, 620, 360)
    draw_text(60, 50, "SYNTHETIC TEST SPEC")
    draw_text(60, 112, "ITEM")
    draw_text(650, 112, "OZ/PIZZA")
    draw_text(60, 180, "MOZZARELLA")
    draw_text(690, 180, "1.25")
    draw_text(60, 245, "PEPPERONI")
    draw_text(690, 245, "0.50")
    draw_text(60, 310, "TOMATO")
    draw_text(690, 310, "0.75")

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    scanlines = b"".join(
        b"\x00" + bytes(pixels[row * width * 3 : (row + 1) * width * 3])
        for row in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines))
        + chunk(b"IEND", b"")
    )


def _memory_current() -> int | None:
    try:
        return int(open("/sys/fs/cgroup/memory.current", encoding="ascii").read())
    except (OSError, ValueError):
        return None


class MemorySampler:
    def __init__(self) -> None:
        self.baseline = _memory_current()
        self.peak = self.baseline
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._sample, daemon=True)

    def _sample(self) -> None:
        while not self._stop.wait(0.2):
            current = _memory_current()
            if current is not None and (self.peak is None or current > self.peak):
                self.peak = current

    def __enter__(self) -> "MemorySampler":
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self._stop.set()
        self._thread.join(timeout=1)
        current = _memory_current()
        if current is not None and (self.peak is None or current > self.peak):
            self.peak = current


def _health(url: str) -> int | None:
    try:
        with HTTP.open(url, timeout=4) as response:
            return response.status
    except (OSError, urllib.error.URLError):
        return None


def _request(
    messages: list[dict[str, object]],
    max_tokens: int,
    expected_terms: list[str] | None = None,
    expected_numbers: list[str] | None = None,
) -> dict[str, object]:
    payload = {
        "model": proxy.MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0,
        "stream": False,
    }
    request = urllib.request.Request(
        f"{ENDPOINT}/v1/chat/completions",
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.monotonic()
    try:
        with HTTP.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        return {"state": "failed", "reason": "provider-http-error", "status": error.code}
    except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return {"state": "failed", "reason": "provider-unavailable"}

    choice = (result.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    content = message.get("content", "")
    text = content.lower() if isinstance(content, str) else ""
    usage = result.get("usage") or {}
    ordered_terms = [text.find(term.lower()) for term in expected_terms or []]
    expected_names_match = not expected_terms or (
        all(position >= 0 for position in ordered_terms)
        and ordered_terms == sorted(ordered_terms)
    )
    try:
        wanted_numbers = [Decimal(value) for value in expected_numbers or []]
        row_numbers = []
        if expected_terms and len(expected_terms) == len(wanted_numbers):
            for index, position in enumerate(ordered_terms):
                start = position + len(expected_terms[index])
                end = ordered_terms[index + 1] if index + 1 < len(ordered_terms) else len(text)
                values = re.findall(r"(?<![\w.])\d+(?:\.\d+)?", text[start:end])
                row_numbers.append([Decimal(value) for value in values])
        expected_numbers_match = not expected_numbers or (
            len(row_numbers) == len(wanted_numbers)
            and all(len(values) == 1 for values in row_numbers)
            and [values[0] for values in row_numbers] == wanted_numbers
        )
    except InvalidOperation:
        expected_numbers_match = False
    return {
        "state": "completed",
        "latencyMs": round((time.monotonic() - started) * 1000),
        "outputCharacters": len(content) if isinstance(content, str) else 0,
        "completionTokens": usage.get("completion_tokens"),
        "promptTokens": usage.get("prompt_tokens"),
        "finishReason": choice.get("finish_reason"),
        "matchesExpected": (
            expected_names_match and expected_numbers_match
            if expected_terms or expected_numbers
            else "OK" in content
        )
        if isinstance(content, str)
        else False,
        "mentionsRed": "red" in text,
        "mentionsBlue": "blue" in text,
        "redBeforeBlue": (
            "red" in text and "blue" in text and text.index("red") < text.index("blue")
        ),
        "expectedNamesCount": len(expected_terms or []),
        "expectedNamesMatch": expected_names_match,
        "expectedNumbersCount": len(expected_numbers or []),
        "expectedNumbersMatch": expected_numbers_match,
    }


def run_smoke() -> dict[str, object]:
    report: dict[str, object] = {
        "format": "local-ai-synthetic-smoke",
        "formatVersion": 1,
        "model": proxy.MODEL,
        "contextLimitTokens": proxy.CONTEXT_LIMIT,
        "outputLimitTokens": proxy.MAX_OUTPUT_TOKENS,
        "syntheticOnly": True,
        "retainedRawPrompts": False,
        "retainedRawResponses": False,
        "applicationHealthBefore": _health(APP_HEALTH),
    }
    if _health(f"{ENDPOINT}/healthz") != 200:
        report["state"] = "unavailable"
        report["reason"] = "local-evaluator-health-check-failed"
        return report

    with MemorySampler() as memory:
        report["firstText"] = _request(
            [{"role": "user", "content": "Reply with only OK."}],
            8,
        )
        report["repeatText"] = _request(
            [{"role": "user", "content": "Reply with only OK."}],
            8,
        )
        image = base64.b64encode(_png_synthetic_spec()).decode("ascii")
        report["representativeImage"] = _request(
            [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Read the three ingredient rows in order. "
                                "Return the ingredient name and its exact oz per pizza value. "
                                "Do not add units or infer other rows."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image}"},
                        },
                    ],
                }
            ],
            128,
            ["MOZZARELLA", "PEPPERONI", "TOMATO"],
            ["1.25", "0.50", "0.75"],
        )

    text = report["firstText"]
    repeat_text = report["repeatText"]
    image_result = report["representativeImage"]
    assert isinstance(text, dict) and isinstance(repeat_text, dict)
    assert isinstance(image_result, dict)
    report["state"] = (
        "passed"
        if text.get("state") == "completed"
        and text.get("matchesExpected") is True
        and repeat_text.get("state") == "completed"
        and repeat_text.get("matchesExpected") is True
        and image_result.get("state") == "completed"
        and image_result.get("expectedNamesMatch") is True
        and image_result.get("expectedNumbersMatch") is True
        else "failed"
    )
    report["applicationHealthAfter"] = _health(APP_HEALTH)
    report["memoryBaselineBytes"] = memory.baseline
    report["memoryPeakDuringSmokeBytes"] = memory.peak
    report["memoryDeltaDuringSmokeBytes"] = (
        max(0, memory.peak - memory.baseline)
        if memory.peak is not None and memory.baseline is not None
        else None
    )
    return report


if __name__ == "__main__":
    result = run_smoke()
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result.get("state") == "passed" else 1)
