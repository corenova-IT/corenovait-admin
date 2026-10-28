"use client";

import dynamic from "next/dynamic";

/**
 * The interactive trend chart in its own browser bundle. It is still drawn on
 * the server (the chart and its data table are in the page's HTML); only the
 * script for the keyboard and hover read-out loads separately.
 */
export const TrendChart = dynamic(() => import("./TrendChart").then((m) => m.TrendChart));
