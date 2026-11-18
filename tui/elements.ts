import { createElement, type ReactNode } from "react";

// Typed builders for the OpenTUI intrinsic elements the view uses; an empty
// color means the terminal default, which OpenTUI expects as an absent prop.
type Color = string | undefined;
export interface BoxProps {
  key?: string;
  flexDirection?: "row" | "column";
  flexGrow?: number;
  flexShrink?: number;
  height?: number;
  paddingLeft?: number;
  paddingRight?: number;
  overflow?: "hidden" | "visible";
  backgroundColor?: Color;
  onSizeChange?: (this: { height: number }) => void;
}
export interface TextProps {
  key?: string;
  fg?: Color;
  bg?: Color;
  attributes?: number;
  wrapMode?: "none" | "char" | "word";
  truncate?: boolean;
}
export const BOLD = 1;
export const color = (value: string): Color => value || undefined;

export const box = (props: BoxProps, ...children: ReactNode[]) =>
  createElement("box", props, ...children);
export const text = (props: TextProps, ...children: ReactNode[]) =>
  createElement(
    "text",
    { wrapMode: "none", truncate: true, ...props },
    ...children,
  );
export const span = (props: TextProps, ...children: ReactNode[]) =>
  createElement("span", props, ...children);
