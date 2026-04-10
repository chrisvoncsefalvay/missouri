import { state } from "./state";
import { createAnnotationFromApi, highlightElementFromApi } from "./page-api";

function getMarkerBounds(id: string): DOMRect | null {
  const escapedId = CSS.escape(id);
  const marker = document.querySelector(`[data-mo-marker-id="${escapedId}"]`) as Element | null;
  return marker?.getBoundingClientRect() ?? null;
}

function boundsFromRect(rect: DOMRect): Record<string, number> {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

export async function mcpCreateAnnotation(params: any): Promise<any> {
  return createAnnotationFromApi(params);
}

export function mcpGetAnnotationBounds(id: string): any {
  if (!id) {
    return { ok: false, error: "Missing annotation id" };
  }

  const annotation = state.annotations.find((item) => item.id === id);
  if (!annotation) {
    return { ok: false, error: `Annotation not found: ${id}` };
  }

  if (annotation.type === "draw" && annotation.drawPoints?.length) {
    const xs = annotation.drawPoints.map((point) => point.x);
    const ys = annotation.drawPoints.map((point) => point.y);
    return {
      ok: true,
      data: {
        x: Math.round(Math.min(...xs) - window.scrollX),
        y: Math.round(Math.min(...ys) - window.scrollY),
        width: Math.round(Math.max(...xs) - Math.min(...xs)),
        height: Math.round(Math.max(...ys) - Math.min(...ys))
      }
    };
  }

  const rect = getMarkerBounds(id);
  if (rect) {
    return { ok: true, data: boundsFromRect(rect) };
  }

  if (annotation.type === "highlight" && annotation._resolvedRange) {
    const rangeRect = annotation._resolvedRange.getBoundingClientRect();
    if (rangeRect.width > 0 && rangeRect.height > 0) {
      return { ok: true, data: boundsFromRect(rangeRect) };
    }
  }

  return {
    ok: true,
    data: {
      x: Math.round(annotation.position.pageX - window.scrollX),
      y: Math.round(annotation.position.pageY - window.scrollY),
      width: 1,
      height: 1
    }
  };
}

export function mcpHighlightElement(selector: string): any {
  return highlightElementFromApi(selector);
}
