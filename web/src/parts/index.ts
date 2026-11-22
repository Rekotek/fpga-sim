// Part widgets by type (spec section 9.4). A type without its own widget gets a gray plate with a label.
import { ButtonWidget } from "./button";
import { LedWidget } from "./led";
import { ProbeWidget } from "./probe";
import { SwitchWidget } from "./switch";
import type { PartWidget, WidgetBox } from "./types";
import { UartWidget } from "./uart";
import { Ws2812Widget } from "./ws2812";

class PlaceholderWidget implements PartWidget {
  readonly plain = true;

  layout(): WidgetBox {
    return { x: -2.6, y: -1.1, w: 5.2, h: 2.2 };
  }

  draw(): void {
    // The drawing renders the labeled plate: its size depends on the text width in pixels.
  }
}

export function createWidget(type: string): PartWidget {
  if (type === "led") return new LedWidget();
  if (type === "button") return new ButtonWidget();
  if (type === "switch") return new SwitchWidget();
  if (type === "probe") return new ProbeWidget();
  if (type === "uart") return new UartWidget();
  if (type === "ws2812") return new Ws2812Widget();
  return new PlaceholderWidget();
}
