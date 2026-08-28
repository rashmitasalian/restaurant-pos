import React from "react";
import {
  buildBusinessDateRange,
  createDefaultBusinessDateRange,
  formatBusinessRangeLabel,
  suggestInitialTimeWindow,
  supportsTimeFilter,
  timeFilterHint,
  type BusinessDateRange,
  type BusinessRangePreset,
} from "../../shared/businessDateRange";

export function useBusinessDateRange(initial?: Partial<BusinessDateRange>) {
  const [range, setRange] = React.useState<BusinessDateRange>(() => {
    const base = createDefaultBusinessDateRange();
    return { ...base, ...initial };
  });

  const recompute = React.useCallback(
    (patch: Partial<BusinessDateRange> & { preset?: BusinessRangePreset }) => {
      setRange((current) => {
        const next = { ...current, ...patch };
        const candidate = buildBusinessDateRange({
          preset: next.preset,
          timeEnabled: next.timeEnabled,
          fromTime: next.fromTime,
          toTime: next.toTime,
          customFromDate: next.customFromDate,
          customToDate: next.customToDate,
          timezone: next.timezone,
        });
        if (!supportsTimeFilter(candidate)) {
          return buildBusinessDateRange({
            preset: candidate.preset,
            timeEnabled: false,
            fromTime: candidate.fromTime,
            toTime: candidate.toTime,
            customFromDate: candidate.customFromDate,
            customToDate: candidate.customToDate,
            timezone: candidate.timezone,
          });
        }
        return candidate;
      });
    },
    [],
  );

  const setPreset = React.useCallback(
    (preset: BusinessRangePreset) => {
      const disableTime = preset === "thisWeek" || preset === "thisMonth";
      recompute({ preset, ...(disableTime ? { timeEnabled: false } : {}) });
    },
    [recompute],
  );

  const setTimeEnabled = React.useCallback(
    (timeEnabled: boolean) => {
      if (timeEnabled) {
        const suggested = suggestInitialTimeWindow();
        recompute({
          timeEnabled: true,
          fromTime: suggested.fromTime,
          toTime: suggested.toTime,
        });
        return;
      }
      recompute({ timeEnabled: false });
    },
    [recompute],
  );

  const setFromTime = React.useCallback(
    (fromTime: string) => {
      recompute({ fromTime, timeEnabled: true });
    },
    [recompute],
  );

  const setToTime = React.useCallback(
    (toTime: string) => {
      recompute({ toTime, timeEnabled: true });
    },
    [recompute],
  );

  const setCustomFromDate = React.useCallback(
    (customFromDate: string) => {
      recompute({ preset: "custom", customFromDate });
    },
    [recompute],
  );

  const setCustomToDate = React.useCallback(
    (customToDate: string) => {
      recompute({ preset: "custom", customToDate });
    },
    [recompute],
  );

  const applyCustomRange = React.useCallback(() => {
    recompute({ preset: "custom" });
  }, [recompute]);

  const label = React.useMemo(() => formatBusinessRangeLabel(range), [range]);
  const canUseTimeFilter = supportsTimeFilter(range);
  const timeHint = timeFilterHint(range);

  return {
    range,
    fromTs: range.from,
    toTs: range.to,
    label,
    canUseTimeFilter,
    timeHint,
    setPreset,
    setTimeEnabled,
    setFromTime,
    setToTime,
    setCustomFromDate,
    setCustomToDate,
    applyCustomRange,
  };
}

export type BusinessDateRangeState = ReturnType<typeof useBusinessDateRange>;
