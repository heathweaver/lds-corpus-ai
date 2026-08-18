import { type PageProps } from "fresh";

export default function App({ Component }: PageProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>LDS Corpus Research</title>
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
