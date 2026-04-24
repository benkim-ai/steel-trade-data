import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Steel Trade Data",
    short_name: "Steel Trade",
    description: "글로벌 철강 수출입 데이터 대시보드",
    start_url: "/",
    display: "standalone",
    background_color: "#fbfcdb",
    theme_color: "#fbfcdb",
    icons: [
      {
        src: "/icon.png",
        sizes: "1280x1280",
        type: "image/png",
      },
      {
        src: "/apple-icon.png",
        sizes: "1280x1280",
        type: "image/png",
      },
    ],
  };
}
