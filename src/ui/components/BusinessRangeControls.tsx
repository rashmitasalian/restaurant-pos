import React from "react";
import { BUSINESS_RANGE_PRESETS, toInputDate } from "../../shared/businessDateRange";
import { SegmentedControl } from "./ui/SegmentedControl";
import type { BusinessDateRangeState } from "../hooks/useBusinessDateRange";
import styles from "./BusinessRangeControls.module.css";

const PRESET_OPTIONS = BUSINESS_RANGE_PRESETS.map(({ key, label }) => ({
  id: key,
  label,
}));

type BusinessRangeControlsProps = {
  rangeState: BusinessDateRangeState;
  className?: string;
};

export function BusinessRangeControls({ rangeState, className = "" }: BusinessRangeControlsProps) {
  const {
    range,
    canUseTimeFilter,
    timeHint,
    setPreset,
    setTimeEnabled,
    setFromTime,
    setToTime,
    setCustomFromDate,
    setCustomToDate,
  } = rangeState;

  const showCustomDates = range.preset === "custom";

  return (
    <div className={`${styles.panel} ${className}`.trim()}>
      <SegmentedControl
        ariaLabel="Report period"
        options={PRESET_OPTIONS}
        value={range.preset}
        onChange={(id) => setPreset(id as typeof range.preset)}
      />

      {showCustomDates && (
        <div className={styles.secondaryRow}>
          <input
            type="date"
            className={styles.dateInput}
            value={range.customFromDate}
            max={range.customToDate}
            aria-label="From date"
            onChange={(e) => setCustomFromDate(e.target.value)}
          />
          <span className={styles.separator}>to</span>
          <input
            type="date"
            className={styles.dateInput}
            value={range.customToDate}
            min={range.customFromDate}
            max={toInputDate(Date.now())}
            aria-label="To date"
            onChange={(e) => setCustomToDate(e.target.value)}
          />
        </div>
      )}

      {canUseTimeFilter && (
        <div className={styles.secondaryRow}>
          {range.timeEnabled ? (
            <>
              <span className={styles.inlineLabel}>Time</span>
              <input
                type="time"
                className={styles.timeInput}
                value={range.fromTime}
                aria-label="From time"
                onChange={(e) => setFromTime(e.target.value)}
              />
              <span className={styles.separator}>to</span>
              <input
                type="time"
                className={styles.timeInput}
                value={range.toTime}
                aria-label="To time"
                onChange={(e) => setToTime(e.target.value)}
              />
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setTimeEnabled(false)}
              >
                Full day
              </button>
            </>
          ) : (
            <button type="button" className={styles.linkBtn} onClick={() => setTimeEnabled(true)}>
              Filter by time of day
            </button>
          )}
        </div>
      )}

      {timeHint ? <p className={styles.hint}>{timeHint}</p> : null}
    </div>
  );
}

type BusinessRangePanelProps = {
  rangeState: BusinessDateRangeState;
  /** Short metric line, e.g. "5 bills · ₹3,880" */
  metric?: string;
  /** One-line context, e.g. "By bill created time" */
  context?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function BusinessRangePanel({
  rangeState,
  metric,
  context,
  actions,
  className = "",
}: BusinessRangePanelProps) {
  const { label } = rangeState;

  return (
    <div className={`${styles.wrap} ${className}`.trim()}>
      <div className={styles.headerRow}>
        <BusinessRangeControls rangeState={rangeState} />
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      <div className={styles.footer}>
        <span className={styles.footerRange}>{label}</span>
        {metric ? (
          <>
            <span className={styles.footerDot}>·</span>
            <span className={styles.footerMetric}>{metric}</span>
          </>
        ) : null}
        {context ? <span className={styles.footerContext}>{context}</span> : null}
      </div>
    </div>
  );
}
