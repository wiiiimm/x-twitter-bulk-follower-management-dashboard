"use client";

import { Bar, BarChart, Cell, XAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  activityByYear,
  yearFullyBeforeCutoff,
  type ActivityYearBucket,
} from "@/lib/activity-by-year";
import type { FollowRow } from "@/lib/follows";
import { cn } from "@/lib/utils";

const chartConfig = {
  count: {
    label: "Accounts",
    color: "var(--chart-3)",
  },
  quiet: {
    label: "Last active before cutoff",
    color: "var(--chart-4)",
  },
  later: {
    label: "Last active on or after cutoff",
    color: "var(--chart-1)",
  },
  unknown: {
    label: "Unknown / never",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

type ChartRow = ActivityYearBucket & { fill: string };

function rowsForChart(rows: FollowRow[], cutoff: Date | null): ChartRow[] {
  return activityByYear(rows).map((bucket) => {
    if (bucket.year == null) {
      return { ...bucket, fill: "var(--color-unknown)" };
    }
    if (yearFullyBeforeCutoff(bucket.year, cutoff)) {
      return { ...bucket, fill: "var(--color-quiet)" };
    }
    return { ...bucket, fill: "var(--color-later)" };
  });
}

export function ActivityYearChart({
  rows,
  cutoff,
  className,
  onSelectYear,
}: {
  rows: FollowRow[];
  cutoff: Date | null;
  className?: string;
  onSelectYear: (year: number) => void;
}) {
  const data = rowsForChart(rows, cutoff);

  return (
    <div className={cn("flex min-w-0 flex-col justify-center", className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Last active at year start
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Load a CSV to plot how many accounts were last active in each year.
        </p>
      ) : (
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[5.5rem] w-full"
          initialDimension={{ width: 560, height: 88 }}
        >
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
          >
            <XAxis
              dataKey="tick"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              interval={0}
              tick={{ fontSize: 10 }}
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={
                <ChartTooltipContent
                  hideIndicator
                  labelFormatter={(_, payload) => {
                    const bucket = payload[0]?.payload as ChartRow | undefined;
                    if (!bucket) return "";
                    if (bucket.year == null) return "Unknown / never posted";
                    return `Last active in ${bucket.year}`;
                  }}
                />
              }
            />
            <Bar
              dataKey="count"
              name="Accounts"
              radius={2}
              maxBarSize={28}
              onClick={(item) => {
                const year = item.payload?.year;
                if (typeof year === "number") onSelectYear(year);
              }}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.key}
                  fill={entry.fill}
                  cursor={entry.year == null ? "default" : "pointer"}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
