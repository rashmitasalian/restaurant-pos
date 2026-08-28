import React from "react";
import {
  BUSINESS_RANGE_PRESETS,
  toInputDate,
} from "../../shared/businessDateRange";
import type { BusinessDateRangeState } from "../hooks/useBusinessDateRange";
import styles from "./BusinessRangeControls.module.css";

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
    applyCustomRange,
  } = rangeState;

  return (
    <div className={`${styles.panel} ${className}`.trim()}>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Period</span>
        <div className={styles.presets}>
          {BUSINESS_RANGE_PRESETS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`${styles.presetBtn}${range.preset === key ? ` ${styles.presetBtnActive}` : ""}`}
              aria-pressed={range.preset === key}
              onClick={() => setPreset(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {range.preset === "custom" && (
        <div className={styles.row}>
          <span className={styles.rowLabel}>Dates</span>
          <div className={styles.customDates}>
            <input
              type="date"
              className={styles.dateInput}
              value={range.customFromDate}
              max={range.customToDate}
              onChange={(e) => setCustomFromDate(e.target.value)}
            />
            <span className={styles.separator}>to</span>
            <input
              type="date"
              className={styles.dateInput}
              value={range.customToDate}
              min={range.customFromDate}
              max={toInputDate(Date.now())}
              onChange={(e) => setCustomToDate(e.target.value)}
            />
            <button type="button" className={styles.applyBtn} onClick={applyCustomRange}>
              Apply
            </button>
          </div>
        </div>
      )}

      {canUseTimeFilter ? (
        <div className={styles.row}>
          <span className={styles.rowLabel}>Time</span>
          {range.timeEnabled ? (
            <div className={styles.timeControls}>
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
                Clear
              </button>
            </div>
          ) : (
            <button type="button" className={styles.linkBtn} onClick={() => setTimeEnabled(true)}>
              Add time window
            </button>
          )}
        </div>
      ) : timeHint ? (
        <p className={styles.hint}>{timeHint}</p>
      ) : null}
    </div>
  );
}

type BusinessRangePanelProps = {
  rangeState: BusinessDateRangeState;
  semanticsLabel: string;
  description: string;
  detail?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function BusinessRangePanel({
  rangeState,
  semanticsLabel,
  description,
  detail,
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
        <div className={styles.footerMain}>
          <span className={styles.footerRange}>{label}</span>
          <span className={styles.footerDot}>·</span>
          <span className={styles.footerSemantics}>{semanticsLabel}</span>
          {detail ? (
            <>
              <span className={styles.footerDot}>·</span>
              <span className={styles.footerDetail}>{detail}</span>
            </>
          ) : null}
        </div>
        <p className={styles.footerNote}>{description}</p>
      </div>
    </div>
  );
}
