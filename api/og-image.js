import sharp from "sharp";
// Replicates the existing Straylo SVG mark and colors—no replacement logo.
const cardSvg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1200\" height=\"630\" viewBox=\"0 0 1200 630\">\n<defs><radialGradient id=\"light\" cx=\"75%\" cy=\"47%\" r=\"70%\"><stop stop-color=\"#1e3543\"/><stop offset=\"1\" stop-color=\"#090d16\"/></radialGradient></defs>\n<rect width=\"1200\" height=\"630\" fill=\"#090d16\"/><rect width=\"1200\" height=\"630\" fill=\"url(#light)\" opacity=\".5\"/>\n<circle cx=\"1000\" cy=\"320\" r=\"280\" stroke=\"#52776d\" stroke-opacity=\".38\" stroke-width=\"2\" fill=\"none\"/>\n<circle cx=\"1000\" cy=\"320\" r=\"175\" stroke=\"#52776d\" stroke-opacity=\".40\" stroke-width=\"2\" fill=\"none\"/>\n<circle cx=\"994\" cy=\"72\" r=\"8\" fill=\"#bdffac\"/><circle cx=\"789\" cy=\"508\" r=\"7\" fill=\"#bdffac\" opacity=\".7\"/>\n<rect x=\"104\" y=\"151\" width=\"108\" height=\"108\" rx=\"31\" fill=\"#bdffac\"/>\n<g transform=\"translate(104 151) scale(1.6875)\"><path d=\"M13 39c12-24 26-24 38 0M17 22c12 24 22 24 34 0\" stroke=\"#10271d\" stroke-width=\"5.5\" fill=\"none\" stroke-linecap=\"round\"/></g>\n<text x=\"238\" y=\"241\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"107\" font-weight=\"800\" fill=\"#f8fafb\" letter-spacing=\"-6\">straylo<tspan fill=\"#bdffac\">.</tspan></text>\n<text x=\"106\" y=\"393\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"49\" font-weight=\"700\" fill=\"#bdffac\">Meet the unexpected.</text>\n<text x=\"107\" y=\"442\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"25\" fill=\"#aeb9c7\">Random video &amp; text chat. Real conversations.</text>\n<rect x=\"104\" y=\"538\" width=\"992\" height=\"2\" fill=\"#314252\"/><text x=\"106\" y=\"580\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"22\" fill=\"#c2ccda\">straylo.com</text>\n</svg>";
let cachedImage;
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }
  try {
    cachedImage ||= sharp(Buffer.from(cardSvg)).png().toBuffer();
    const image = await cachedImage;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(image.length));
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).end(req.method === "HEAD" ? undefined : image);
  } catch (error) {
    cachedImage = undefined;
    console.error("Social preview rendering failed", error);
    return res.status(500).end("Preview unavailable");
  }
}