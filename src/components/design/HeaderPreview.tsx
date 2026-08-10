import { CANVAS_WIDTH, CANVAS_HEIGHT, TITLE_BOX_HEIGHT, textStyleToCss, type FormTheme } from "@/types/theme";

function boxStyle(el: { x: number; y: number; width: number; height: number }) {
  return {
    left: `${el.x}%`,
    top: `${el.y}%`,
    width: `${el.width}%`,
    height: `${el.height}%`,
  };
}

export function HeaderPreview({
  theme,
  title,
}: {
  theme: FormTheme;
  title: string;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-royal-100"
      style={{
        aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
        backgroundColor: theme.headerBackgroundColor,
      }}
    >
      {theme.logo.dataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={theme.logo.dataUrl}
          alt="Logo"
          className="absolute object-contain"
          style={boxStyle(theme.logo)}
        />
      )}

      <div
        className="absolute flex items-center overflow-hidden whitespace-nowrap"
        style={{
          ...boxStyle({ ...theme.title, height: TITLE_BOX_HEIGHT }),
          ...textStyleToCss(theme.title),
        }}
      >
        {title || "Untitled form"}
      </div>

      {theme.images.map(
        (image) =>
          image.dataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={image.id}
              src={image.dataUrl}
              alt=""
              className="absolute object-contain"
              style={boxStyle(image)}
            />
          ),
      )}

      {theme.texts.map((text) => (
        <div
          key={text.id}
          className="absolute flex items-center overflow-hidden whitespace-nowrap"
          style={{
            ...boxStyle({ ...text, height: TITLE_BOX_HEIGHT }),
            ...textStyleToCss(text),
          }}
        >
          {text.content}
        </div>
      ))}
    </div>
  );
}
