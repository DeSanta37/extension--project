import {
  usePostMessaging
} from "./chunk-ICLXI4BR.js";
import {
  createEndpointRuntime,
  createStreamWirings
} from "./chunk-QIZ4XBKF.js";
import "./chunk-REMFLVJH.js";

// src/window.ts
var win = usePostMessaging("window");
var endpointRuntime = createEndpointRuntime("window", (message) => win.postMessage(message));
win.onMessage((msg) => {
  if ("type" in msg && "transactionID" in msg)
    endpointRuntime.endTransaction(msg.transactionID);
  else
    endpointRuntime.handleMessage(msg);
});
function setNamespace(nsps) {
  win.setNamespace(nsps);
  win.enable();
}
var { sendMessage, onMessage } = endpointRuntime;
var { openStream, onOpenStreamChannel } = createStreamWirings(endpointRuntime);
export {
  onMessage,
  onOpenStreamChannel,
  openStream,
  sendMessage,
  setNamespace
};
