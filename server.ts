import { Elysia } from "elysia";
import staticPlugin from "@elysiajs/static";
import { queueRoute } from "./src/routes/queue";
import { stopRoute } from "./src/routes/stop";
import { imagesRoute } from "./src/routes/images";

export const app = new Elysia()
  .use(staticPlugin({ assets: "public", prefix: "/" }))
  .get("/", () => Bun.file("public/index.html"))
  .use(queueRoute)
  .use(stopRoute)
  .use(imagesRoute)
  .listen(3000);

export type App = typeof app;
console.log("Listening on http://localhost:3000");
