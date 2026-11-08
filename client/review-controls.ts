const icons = {
  refresh: ["M20 7v5h-5", "M20 12a8 8 0 1 0-2.3 5.7"],
  split: ["M3 4h18v16H3z", "M12 4v16"],
  unified: ["M3 4h18v16H3z", "M3 12h18"],
  tree: ["M3 4h18v16H3z", "M9 4v16", "M5 8h2m-2 4h2m-2 4h2"],
  collapse: ["m8 3 4 4 4-4", "m8 21 4-4 4 4", "M4 10h16M4 14h16"],
  expand: ["m8 7 4-4 4 4", "m8 17 4 4 4-4", "M4 10h16M4 14h16"],
  previous: ["M12 20V4", "m5 11 7-7 7 7"],
  next: ["M12 4v16", "m5 13 7 7 7-7"],
  keyboard: ["M2 5h20v14H2z", "M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 15h6"],
  send: ["m21 3-7 18-4-7-7-4Z", "m10 14 11-11"],
  comments: ["M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"],
  close: ["m6 6 12 12M6 18 18 6"],
};

/** Icon actions retain a visible tooltip and an accessible name. */
export function setButtonIcon(
  button: HTMLButtonElement,
  icon: keyof typeof icons,
  label: string,
  count?: number,
): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.7",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  }))
    svg.setAttribute(name, value);
  for (const d of icons[icon]) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  button.replaceChildren(svg);
  if (count !== undefined) {
    const badge = document.createElement("span");
    badge.textContent = String(count);
    badge.setAttribute("aria-hidden", "true");
    button.append(badge);
  }
  button.setAttribute("aria-label", label);
  button.title = label;
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    minWidth: "30px",
    height: "30px",
    boxSizing: "border-box",
    padding: "5px",
    flexShrink: "0",
  });
}
