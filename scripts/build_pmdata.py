"""Prepare PMData for the local DUVA Rhythm Explorer.

The output keeps sleep-shape evidence and lifestyle context separate. Raw Fitbit
records remain untouched. This script only creates browser-friendly derived JSON.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any


PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_RAW = PROJECT / "data" / "raw"
DEFAULT_OUTPUT = PROJECT / "public" / "data" / "pmdata.json"
DEFAULT_VALIDATION = PROJECT / "public" / "data" / "pmdata_validation.json"
STAGE_DEPTH = {
    "wake": 0.0,
    "awake": 0.0,
    "rem": 1.0,
    "restless": 1.25,
    "light": 2.0,
    "asleep": 2.0,
    "deep": 3.0,
}


def parse_datetime(value: str) -> datetime:
    normalized = value.replace("T", " ").replace("Z", "")
    return datetime.fromisoformat(normalized)


def read_json(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


HEART_RATE_RECORD = re.compile(
    rb'\{\s*"dateTime"\s*:\s*"([^"]+)"\s*,\s*"value"\s*:\s*\{\s*"bpm"\s*:\s*(\d+)\s*,\s*"confidence"\s*:\s*(\d+)\s*\}\s*\}'
)


def stream_heart_rate(path: Path):
    """Yield compact Fitbit HR records without loading a 50–120 MB file at once."""
    if not path.exists():
        return
    buffer = b""
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1_048_576)
            final = not chunk
            buffer += chunk
            safe_end = len(buffer) if final else max(0, len(buffer) - 512)
            consumed = 0
            for match in HEART_RATE_RECORD.finditer(buffer):
                if match.end() > safe_end:
                    break
                consumed = match.end()
                yield match.group(1).decode("ascii"), int(match.group(2)), int(match.group(3))
            if consumed:
                buffer = buffer[consumed:]
            elif not final and len(buffer) > 1024:
                buffer = buffer[-512:]
            if final:
                break


def histogram_quantile(counts: list[int], q: float, minimum_bpm: int = 30) -> float | None:
    total = sum(counts)
    if not total:
        return None
    target = (total - 1) * q
    cumulative = 0
    for index, count in enumerate(counts):
        cumulative += count
        if cumulative > target:
            return float(index + minimum_bpm)
    return float(len(counts) - 1 + minimum_bpm)


def numeric_quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    base = math.floor(position)
    rest = position - base
    if base + 1 >= len(ordered):
        return float(ordered[base])
    return float(ordered[base] + (ordered[base + 1] - ordered[base]) * rest)


def heart_rate_settling_metrics(interval: dict[str, Any]) -> dict[str, Any]:
    """Describe how quickly HR reaches a sustained low band after sleep starts.

    The estimate is deliberately censored at 90 minutes. It requires at least
    60% minute coverage and looks for the first 20-minute period in which 80%
    of observed minutes remain within 3 bpm of the night's lower quartile.
    """
    minute_values = {
        minute: numeric_quantile(values, 0.5)
        for minute, values in interval["minuteValues"].items()
        if values
    }
    first_90 = [minute_values.get(minute) for minute in range(90)]
    observed_first_90 = [value for value in first_90 if value is not None]
    coverage = len(observed_first_90) / 90
    all_minutes = [value for _, value in sorted(minute_values.items())]
    baseline = numeric_quantile(all_minutes, 0.25)
    if coverage < 0.6 or baseline is None:
        return {
            "heartRateSettlingMinutes": None,
            "heartRateSettledWithin90": None,
            "heartRateFirst90DeltaBpm": None,
            "heartRateFirst90HighShare": None,
            "heartRateFirst90MinuteCoverage": round(coverage, 3),
        }

    threshold = baseline + 3
    settling_minute = 90
    for minute in range(71):
        lookahead = [value for value in first_90[minute:minute + 20] if value is not None]
        if len(lookahead) >= 12 and sum(value <= threshold for value in lookahead) / len(lookahead) >= 0.8:
            settling_minute = minute
            break

    opening = [value for value in first_90[:15] if value is not None]
    opening_median = numeric_quantile(opening, 0.5)
    high_share = sum(value > threshold for value in observed_first_90) / len(observed_first_90)
    return {
        "heartRateSettlingMinutes": settling_minute,
        "heartRateSettledWithin90": settling_minute < 90,
        "heartRateFirst90DeltaBpm": round(max(0.0, (opening_median or baseline) - baseline), 1),
        "heartRateFirst90HighShare": round(high_share, 3),
        "heartRateFirst90MinuteCoverage": round(coverage, 3),
    }


def parse_resting_heart_rate(path: Path) -> dict[date, float]:
    result: dict[date, float] = {}
    for record in read_json(path):
        try:
            record_date = parse_datetime(record["dateTime"]).date()
            value = float((record.get("value") or {}).get("value") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if 30 <= value <= 120:
            result[record_date] = round(value, 2)
    return result


def sleep_heart_rate_metrics(path: Path, records: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    intervals = []
    for key, record in records.items():
        start = parse_datetime(record["startTime"])
        end = parse_datetime(record["endTime"])
        if end <= start:
            end += timedelta(days=1)
        intervals.append({
            "key": key,
            "start": start,
            "end": end,
            "counts": [0] * 191,
            "valid": 0,
            "highConfidence": 0,
            "minutes": set(),
            "minuteValues": defaultdict(list),
        })
    intervals.sort(key=lambda item: item["start"])
    pointer = 0
    for raw_time, bpm, confidence in stream_heart_rate(path):
        if bpm < 30 or bpm > 220:
            continue
        try:
            moment = parse_datetime(raw_time)
        except ValueError:
            continue
        while pointer < len(intervals) and moment >= intervals[pointer]["end"]:
            pointer += 1
        if pointer >= len(intervals):
            break
        interval = intervals[pointer]
        if moment < interval["start"] or confidence < 1:
            continue
        interval["counts"][bpm - 30] += 1
        interval["valid"] += 1
        interval["highConfidence"] += int(confidence >= 2)
        interval["minutes"].add(moment.replace(second=0, microsecond=0))
        minute_index = math.floor((moment - interval["start"]).total_seconds() / 60)
        if minute_index >= 0:
            interval["minuteValues"][minute_index].append(bpm)

    result: dict[str, dict[str, Any]] = {}
    for interval in intervals:
        duration_minutes = max(1.0, (interval["end"] - interval["start"]).total_seconds() / 60)
        minute_coverage = min(1.0, len(interval["minutes"]) / duration_minutes)
        enough = interval["valid"] >= 120 and minute_coverage >= 0.5
        result[interval["key"]] = {
            "sleepMedianBpm": round(histogram_quantile(interval["counts"], 0.5), 1) if enough else None,
            "sleepLowBpm": round(histogram_quantile(interval["counts"], 0.1), 1) if enough else None,
            "heartRateSampleCount": interval["valid"],
            "heartRateMinuteCoverage": round(minute_coverage, 3),
            "heartRateHighConfidenceShare": round(interval["highConfidence"] / max(1, interval["valid"]), 3),
            **heart_rate_settling_metrics(interval),
        }
    return result


def parse_food(path: Path) -> tuple[dict[date, dict[str, Any]], int]:
    if not path.exists():
        return {}, 0
    records: dict[date, dict[str, Any]] = {}
    row_count = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            row_count += 1
            raw_date = (row.get("date") or "").strip()
            try:
                report_date = datetime.strptime(raw_date, "%d/%m/%Y").date()
            except ValueError:
                continue
            meals = [item.strip() for item in (row.get("meals") or "").split(",") if item.strip()]
            try:
                fluid = float(row.get("glasses_of_fluid") or 0)
            except ValueError:
                fluid = 0.0
            alcohol_text = (row.get("alcohol_consumed") or "").strip().lower()
            records[report_date] = {
                "reported": True,
                "meals": meals,
                "fluidGlasses": fluid,
                "alcohol": alcohol_text in {"yes", "y", "true", "1"},
            }
    return records, row_count


def parse_wellness(path: Path) -> tuple[dict[date, dict[str, Any]], int]:
    if not path.exists():
        return {}, 0
    records: dict[date, dict[str, Any]] = {}
    row_count = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            row_count += 1
            try:
                record_date = parse_datetime(row["effective_time_frame"]).date()
            except (KeyError, ValueError):
                continue
            result: dict[str, Any] = {"reported": True}
            for source, target in (
                ("fatigue", "fatigue"),
                ("mood", "mood"),
                ("readiness", "readiness"),
                ("sleep_quality", "sleepQuality"),
                ("soreness", "soreness"),
                ("stress", "stress"),
            ):
                try:
                    result[target] = float(row.get(source) or 0)
                except ValueError:
                    result[target] = None
            records[record_date] = result
    return records, row_count


def exercise_intervals(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for record in records:
        try:
            start = parse_datetime(record["startTime"])
        except (KeyError, ValueError):
            continue
        duration_minutes = float(record.get("duration") or 0) / 60_000
        end = start + timedelta(minutes=duration_minutes)
        intensity_minutes = sum(
            float(level.get("minutes") or 0)
            for level in record.get("activityLevel", [])
            if level.get("name") in {"fairly", "very"}
        )
        parsed.append(
            {
                "start": start,
                "end": end,
                "minutes": duration_minutes,
                "intensityMinutes": intensity_minutes,
                "calories": float(record.get("calories") or 0),
                "steps": float(record.get("steps") or 0),
                "type": record.get("activityName") or "Activity",
            }
        )
    return parsed


def sample_profile(record: dict[str, Any], start: datetime, end: datetime) -> list[float]:
    intervals: list[tuple[datetime, datetime, float, int]] = []
    levels = record.get("levels") or {}
    for priority, key in ((0, "data"), (1, "shortData")):
        for item in levels.get(key, []) or []:
            try:
                item_start = parse_datetime(item["dateTime"])
                item_end = item_start + timedelta(seconds=float(item.get("seconds") or 0))
            except (KeyError, ValueError):
                continue
            intervals.append((item_start, item_end, STAGE_DEPTH.get(str(item.get("level", "")).lower(), 1.5), priority))
    total_seconds = max(1.0, (end - start).total_seconds())
    profile: list[float] = []
    for index in range(29):
        moment = start + timedelta(seconds=total_seconds * index / 28)
        matching = [item for item in intervals if item[0] <= moment < item[1]]
        if matching:
            profile.append(max(matching, key=lambda item: item[3])[2])
        else:
            profile.append(0.0 if index in {0, 28} else 2.0)
    return profile


def first_90_sleep_structure(record: dict[str, Any], start: datetime) -> dict[str, Any]:
    boundary = start + timedelta(minutes=90)
    staged: list[tuple[datetime, datetime, str]] = []
    levels = record.get("levels") or {}
    for item in levels.get("data", []) or []:
        try:
            item_start = parse_datetime(item["dateTime"])
            item_end = item_start + timedelta(seconds=float(item.get("seconds") or 0))
        except (KeyError, ValueError):
            continue
        if item_start < boundary and item_end > start:
            staged.append((item_start, item_end, str(item.get("level", "")).lower()))

    minute_stages: list[str | None] = []
    for minute in range(90):
        moment = start + timedelta(minutes=minute, seconds=30)
        match = next((level for item_start, item_end, level in staged if item_start <= moment < item_end), None)
        minute_stages.append(match)
    observed = [value for value in minute_stages if value]
    transitions = sum(
        1
        for previous, current in zip(minute_stages, minute_stages[1:])
        if previous and current and previous != current
    )
    wake_minutes = sum(value in {"wake", "awake", "restless"} for value in observed)
    brief_wake_events = 0
    for item in levels.get("shortData", []) or []:
        try:
            item_start = parse_datetime(item["dateTime"])
        except (KeyError, ValueError):
            continue
        if start <= item_start < boundary:
            brief_wake_events += 1
    return {
        "first90StageTransitions": transitions if len(observed) >= 60 else None,
        "first90WakeMinutes": wake_minutes if len(observed) >= 60 else None,
        "first90BriefWakeEvents": brief_wake_events if len(observed) >= 60 else None,
        "first90DisruptionEvents": transitions + brief_wake_events if len(observed) >= 60 else None,
        "first90StageCoverage": round(len(observed) / 90, 3),
    }


def stage_mix(record: dict[str, Any]) -> dict[str, float]:
    summary = ((record.get("levels") or {}).get("summary") or {})
    values = {key: float((summary.get(key) or {}).get("minutes") or 0) for key in ("deep", "light", "rem", "wake")}
    total = sum(values.values()) or 1.0
    return {key: round(value / total, 4) for key, value in values.items()}


def extended_hour(moment: datetime) -> float:
    value = moment.hour + moment.minute / 60 + moment.second / 3600
    return value + 24 if value < 18 else value


def context_date_for(start: datetime) -> date:
    return (start - timedelta(days=1)).date() if start.hour < 12 else start.date()


def exercise_context(exercises: list[dict[str, Any]], start: datetime) -> dict[str, Any]:
    daily = [item for item in exercises if start - timedelta(hours=18) <= item["start"] < start]
    recent = [item for item in daily if item["end"] >= start - timedelta(hours=6)]
    last = max((item["end"] for item in daily), default=None)
    return {
        "matched": bool(daily),
        "count": len(daily),
        "totalMinutes": round(sum(item["minutes"] for item in daily), 1),
        "recentMinutes": round(sum(item["minutes"] for item in recent), 1),
        "intensityMinutes": round(sum(item["intensityMinutes"] for item in daily), 1),
        "eveningExercise": sum(item["minutes"] for item in recent) >= 15,
        "highLoad": sum(item["minutes"] for item in daily) >= 60,
        "lastEndHoursBeforeSleep": round((start - last).total_seconds() / 3600, 2) if last else None,
        "types": sorted({item["type"] for item in daily}),
    }


def sleep_record_to_day(
    participant: str,
    record: dict[str, Any],
    naps: list[dict[str, Any]],
    exercises: list[dict[str, Any]],
    food: dict[date, dict[str, Any]],
    wellness: dict[date, dict[str, Any]],
    heart_rate: dict[str, dict[str, Any]],
    resting_heart_rate: dict[date, float],
) -> dict[str, Any]:
    start = parse_datetime(record["startTime"])
    end = parse_datetime(record["endTime"])
    if end <= start:
        end += timedelta(days=1)
    sleep_date = datetime.strptime(record["dateOfSleep"], "%Y-%m-%d").date()
    matching_naps = [item for item in naps if item.get("dateOfSleep") == record.get("dateOfSleep")]
    nap_minutes = sum(float(item.get("minutesAsleep") or 0) for item in matching_naps)
    nap_start = None
    if matching_naps:
        nap_start = min(parse_datetime(item["startTime"]) for item in matching_naps)
    context_date = context_date_for(start)
    food_record = food.get(context_date)
    quality = min(1.0, max(0.35, float(record.get("efficiency") or 0) / 100))
    mix = stage_mix(record)
    physiology = heart_rate.get(record["dateOfSleep"], {})
    sleep_structure = first_90_sleep_structure(record, start)
    return {
        "id": f"{participant}-{sleep_date.isoformat()}",
        "date": sleep_date.isoformat(),
        "valid": True,
        "bed": round(extended_hour(start), 4),
        "wake": round(extended_hour(end), 4),
        "duration": round(float(record.get("minutesAsleep") or 0) / 60, 4),
        "timeInBed": round(float(record.get("timeInBed") or 0) / 60, 4),
        "nap": bool(matching_naps),
        "napStart": round(nap_start.hour + nap_start.minute / 60, 3) if nap_start else None,
        "napDuration": round(nap_minutes / 60, 3),
        "stages": mix,
        "profile": sample_profile(record, start, end),
        "quality": round(quality, 4),
        "physiology": {
            "sleepMedianBpm": physiology.get("sleepMedianBpm"),
            "sleepLowBpm": physiology.get("sleepLowBpm"),
            "restingBpm": resting_heart_rate.get(sleep_date),
            "heartRateSampleCount": physiology.get("heartRateSampleCount", 0),
            "heartRateMinuteCoverage": physiology.get("heartRateMinuteCoverage", 0),
            "heartRateHighConfidenceShare": physiology.get("heartRateHighConfidenceShare", 0),
            "heartRateSettlingMinutes": physiology.get("heartRateSettlingMinutes"),
            "heartRateSettledWithin90": physiology.get("heartRateSettledWithin90"),
            "heartRateFirst90DeltaBpm": physiology.get("heartRateFirst90DeltaBpm"),
            "heartRateFirst90HighShare": physiology.get("heartRateFirst90HighShare"),
            "heartRateFirst90MinuteCoverage": physiology.get("heartRateFirst90MinuteCoverage", 0),
        },
        "sleepStructure": sleep_structure,
        "movement": {
            "sourceAvailable": False,
            "positionChangeCountFirst90": None,
        },
        "environment": {
            "sourceAvailable": False,
            "intermittentNoiseEventsFirst90": None,
        },
        "context": {
            "exercise": exercise_context(exercises, start),
            "food": food_record or {"reported": False, "meals": [], "fluidGlasses": None, "alcohol": None},
            "wellness": wellness.get(sleep_date) or {"reported": False},
            "contextDate": context_date.isoformat(),
        },
        "source": {
            "logId": str(record.get("logId", "")),
            "startTime": start.isoformat(timespec="seconds"),
            "endTime": end.isoformat(timespec="seconds"),
        },
    }


def participant_payload(directory: Path) -> dict[str, Any]:
    participant = directory.name
    sleep_records = read_json(directory / "fitbit" / "sleep.json")
    exercise_records = exercise_intervals(read_json(directory / "fitbit" / "exercise.json"))
    food, food_record_count = parse_food(directory / "googledocs" / "reporting.csv")
    wellness, wellness_record_count = parse_wellness(directory / "pmsys" / "wellness.csv")
    naps = [record for record in sleep_records if record.get("mainSleep") is False]
    complete = [
        record
        for record in sleep_records
        if record.get("mainSleep") is True
        and record.get("type") == "stages"
        and ((record.get("levels") or {}).get("data"))
    ]
    by_date: dict[str, dict[str, Any]] = {}
    for record in complete:
        key = record.get("dateOfSleep")
        if not key:
            continue
        if key not in by_date or float(record.get("minutesAsleep") or 0) > float(by_date[key].get("minutesAsleep") or 0):
            by_date[key] = record
    heart_rate = sleep_heart_rate_metrics(directory / "fitbit" / "heart_rate.json", by_date)
    resting_heart_rate = parse_resting_heart_rate(directory / "fitbit" / "resting_heart_rate.json")
    converted = {
        key: sleep_record_to_day(participant, record, naps, exercise_records, food, wellness, heart_rate, resting_heart_rate)
        for key, record in by_date.items()
    }
    all_main_dates = sorted(
        datetime.strptime(record["dateOfSleep"], "%Y-%m-%d").date()
        for record in sleep_records
        if record.get("mainSleep") is True and record.get("dateOfSleep")
    )
    if all_main_dates:
        start_date = min(all_main_dates)
        end_date = max(all_main_dates)
    else:
        start_date = date(2019, 11, 1)
        end_date = start_date
    days: list[dict[str, Any]] = []
    cursor = start_date
    while cursor <= end_date:
        key = cursor.isoformat()
        days.append(converted.get(key) or {"id": f"{participant}-{key}", "date": key, "valid": False})
        cursor += timedelta(days=1)
    valid = [item for item in days if item["valid"]]
    exercise_matched = sum(1 for item in valid if item["context"]["exercise"]["matched"])
    food_matched = sum(1 for item in valid if item["context"]["food"]["reported"])
    both = sum(
        1
        for item in valid
        if item["context"]["exercise"]["matched"] and item["context"]["food"]["reported"]
    )
    sleep_heart_rate_nights = sum(1 for item in valid if item["physiology"]["sleepMedianBpm"] is not None)
    heart_rate_settling_nights = sum(1 for item in valid if item["physiology"]["heartRateSettlingMinutes"] is not None)
    first_90_structure_nights = sum(1 for item in valid if item["sleepStructure"]["first90DisruptionEvents"] is not None)
    resting_heart_rate_nights = sum(1 for item in valid if item["physiology"]["restingBpm"] is not None)
    return {
        "id": participant,
        "label": f"Participant {participant[1:]}",
        "coverage": round(len(valid) / max(1, len(days)) * 100),
        "dateStart": start_date.isoformat(),
        "dateEnd": end_date.isoformat(),
        "sourceStatus": {
            "validStageNights": len(valid),
            "mainStageRecords": len(complete),
            "exerciseRecords": len(exercise_records),
            "foodReports": food_record_count,
            "foodReportDays": len(food),
            "wellnessReports": wellness_record_count,
            "wellnessReportDays": len(wellness),
            "exerciseMatchedNights": exercise_matched,
            "foodMatchedNights": food_matched,
            "completeContextNights": both,
            "sleepHeartRateNights": sleep_heart_rate_nights,
            "heartRateSettlingNights": heart_rate_settling_nights,
            "first90SleepStructureNights": first_90_structure_nights,
            "restingHeartRateNights": resting_heart_rate_nights,
            "foodAvailable": bool(food),
            "patternEligible": len(valid) >= 4,
        },
        "days": days,
    }


def validation_summary(participants: list[dict[str, Any]], raw: Path) -> dict[str, Any]:
    totals = defaultdict(int)
    eligible = []
    exclusions = []
    for participant in participants:
        status = participant["sourceStatus"]
        for key in (
            "validStageNights",
            "mainStageRecords",
            "exerciseRecords",
            "foodReports",
            "wellnessReports",
            "exerciseMatchedNights",
            "foodMatchedNights",
            "completeContextNights",
            "sleepHeartRateNights",
            "heartRateSettlingNights",
            "first90SleepStructureNights",
            "restingHeartRateNights",
        ):
            totals[key] += int(status[key])
        if status["completeContextNights"] >= 30:
            eligible.append(participant["id"])
        if not status["patternEligible"]:
            exclusions.append({"participant": participant["id"], "reason": "fewer_than_4_valid_stage_nights"})
        if not status["foodAvailable"]:
            exclusions.append({"participant": participant["id"], "reason": "food_context_unavailable"})
    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": str(raw),
        "participantCount": len(participants),
        "totals": dict(totals),
        "participantsWith30CompleteContextNights": eligible,
        "specialHandling": exclusions,
        "contextRules": {
            "exerciseDay": "exercise starting within 18 hours before primary sleep",
            "eveningExercise": "at least 15 minutes ending within 6 hours before primary sleep",
            "foodAnchor": "calendar day preceding an after-midnight sleep start, otherwise sleep-start date",
            "associationBoundary": "context never contributes to Pattern Emergence",
            "physiologyFeatures": "sleep median HR, sleep 10th-percentile HR, first-90-minute HR settling time and daily resting HR; normalized within participant window before Pattern distance",
            "first90Structure": "Fitbit sleep-stage transitions and brief wake events; this is not a body-position measurement",
            "unsupportedSignals": "PMData contains no body-position/IMU or environmental-noise stream; these fields remain unavailable rather than inferred",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build browser-ready DUVA data from an extracted PMData directory.")
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW, help="Directory containing p01, p02, ... PMData folders.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output path for pmdata.json.")
    parser.add_argument("--validation-output", type=Path, default=DEFAULT_VALIDATION, help="Output path for validation summary JSON.")
    args = parser.parse_args()
    raw = args.raw.expanduser().resolve()
    output = args.output.expanduser().resolve()
    validation_output = args.validation_output.expanduser().resolve()
    if not raw.is_dir():
        raise SystemExit(f"PMData directory not found: {raw}")

    directories = sorted(
        (path for path in raw.iterdir() if path.is_dir() and path.name.startswith("p")),
        key=lambda path: int(path.name[1:]),
    )
    participants = [participant_payload(directory) for directory in directories]
    payload = {
        "schemaVersion": "duva-pmdata-v2",
        "source": "PMData",
        "license": "CC BY-NC 4.0",
        "participants": participants,
        "validation": validation_summary(participants, raw),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    validation_output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    validation_output.write_text(json.dumps(payload["validation"], indent=2), encoding="utf-8")
    print(json.dumps(payload["validation"], indent=2))
    print(f"Wrote {output} ({output.stat().st_size / 1_048_576:.2f} MiB)")


if __name__ == "__main__":
    main()
