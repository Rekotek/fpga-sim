// Probe (spec section 6.5): a probe on a pin with a label and the current level. It has no model:
// the pin net goes into configure, and its level is visible in the frame.
import { themeColor } from "../app/theme";
import type { HintLine, PartView, PartWidget, WidgetBox } from "./types";

const R = 1.3; // mm

export class ProbeWidget implements PartWidget {
  layout(): WidgetBox {
    return { x: -R, y: -R, w: 2 * R, h: 3 * R };
  }

  draw(ctx: CanvasRenderingContext2D, view: PartView): void {
    const net = view.nets.in;
    // The fill is the level (1, 0, no net), the same in both themes. The outline and the tip come from the theme:
    // dark gray is not visible on the dark breadboard field.
    const edge = themeColor("--board-probe");
    ctx.fillStyle = net ? (net.level ? "#ffd84a" : "#14171c") : "#9aa3ad";
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.moveTo(-R * 0.45, R * 0.8);
    ctx.lineTo(R * 0.45, R * 0.8);
    ctx.lineTo(0, R * 1.9);
    ctx.fill();
  }

  hint(view: PartView): HintLine[] {
    const net = view.nets.in;
    const text = typeof view.config.settings.label === "string" ? view.config.settings.label : "";
    const lines: HintLine[] = [
      { key: "hint.part", args: { label: text || view.config.label, pin: view.config.pins.in } },
    ];
    if (net) {
      lines.push({ key: "hint.level", args: { level: net.level } });
      lines.push({ key: "hint.duty", args: { percent: Math.round(net.duty * 100) } });
      lines.push({ key: "hint.frequency", args: { hz: net.rate / 2 } });
    }
    return lines;
  }

  status(view: PartView): Record<string, number | boolean> {
    return { level: view.nets.in?.level ?? -1 };
  }
}
