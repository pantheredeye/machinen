import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "@/app/Document";

import { SessionPage } from "./app/pages/session/SessionPage";

export default defineApp([render(Document, [route("/", SessionPage)])]);
