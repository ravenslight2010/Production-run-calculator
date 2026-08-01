import { ScrollViewStyleReset } from "expo-router/html";
import React, { type PropsWithChildren } from "react";

/**
 * Web-only HTML shell for Expo Router. This file has no effect on native.
 *
 * react-native-web's flex:1 app tree collapses to a blank screen unless the
 * html/body/#root chain has an explicit height. We bake that into the static
 * CSS here so the layout is correct on first paint, before any JS measures it.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: rootStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const rootStyle = `
html, body, #root {
  height: 100%;
}
body {
  margin: 0;
  background-color: #131720;
}
#root {
  display: flex;
}
`;
