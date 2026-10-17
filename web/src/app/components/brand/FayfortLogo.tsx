'use client'

import { useId } from "react";
import { LOGO_F_PATH, LOGO_SHELL_PATH, LOGO_VIEWBOX } from "./logoPaths";
import "./brand.css";

export type LogoVariant = "color" | "on-dark" | "silver" | "mono";

/**
 * The FayFort logo as a vector.
 * - color: navy shell and pink F (light backgrounds)
 * - on-dark: white shell and pink F (navy sign-in pages)
 * - silver: the metallic version
 * - mono: one colour (the text colour)
 * `animated` plays the loading animation: the shell draws in, the F slides up, then a silver shine sweeps across.
 */
export function FayfortLogo({
  variant = "color",
  animated = false,
  title,
  className = "",
}: {
  variant?: LogoVariant;
  animated?: boolean;
  title?: string;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const silver = variant === "silver";
  return (
    <svg
      className={`ff-logo ff-logo--${variant}${animated ? " ff-logo--animated" : ""} ${className}`.trim()}
      viewBox={LOGO_VIEWBOX}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        {silver && (
          <linearGradient id={`${id}-silver`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c9ccd1" />
            <stop offset="0.3" stopColor="#f4f5f6" />
            <stop offset="0.45" stopColor="#8d9097" />
            <stop offset="0.62" stopColor="#e9eaec" />
            <stop offset="0.8" stopColor="#9a9da3" />
            <stop offset="1" stopColor="#3f4247" />
          </linearGradient>
        )}
        {animated && (
          <>
            <clipPath id={`${id}-clip`}>
              <path d={LOGO_SHELL_PATH} />
              <path d={LOGO_F_PATH} />
            </clipPath>
            <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.75" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </>
        )}
      </defs>
      <path
        className="ff-logo-shell"
        d={LOGO_SHELL_PATH}
        pathLength={1}
        style={silver ? { fill: `url(#${id}-silver)`, stroke: "#b8bbc0" } : undefined}
      />
      <path className="ff-logo-f" d={LOGO_F_PATH} style={silver ? { fill: `url(#${id}-silver)` } : undefined} />
      {animated && (
        <g clipPath={`url(#${id}-clip)`}>
          <rect className="ff-logo-shine" x="-520" y="-60" width="360" height="1200" fill={`url(#${id}-shine)`} />
        </g>
      )}
    </svg>
  );
}

