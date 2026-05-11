export interface HyperframesPlayerElement extends HTMLElement {
  iframeElement: HTMLIFrameElement;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hyperframes-player": React.HTMLAttributes<HTMLElement> & {
        ref?: React.Ref<HyperframesPlayerElement>;
        srcdoc?: string;
        width?: number | string;
        height?: number | string;
        "shader-capture-scale"?: number | string;
        "shader-loading"?: "composition" | "player" | "none";
      };
    }
  }
}
