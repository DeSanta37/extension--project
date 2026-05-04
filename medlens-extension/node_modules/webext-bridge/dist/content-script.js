import {
  createPersistentPort
} from "./chunk-E2HJRHOS.js";
import "./chunk-G7AOUSAZ.js";
import {
  usePostMessaging
} from "./chunk-ICLXI4BR.js";
import {
  createEndpointRuntime,
  createStreamWirings
} from "./chunk-QIZ4XBKF.js";
import "./chunk-REMFLVJH.js";

// src/content-script.ts
var win = usePostMessaging("content-script");
var port = createPersistentPort();
var endpointRuntime = createEndpointRuntime("content-script", (message) => {
  if (message.destination.context === "window")
    win.postMessage(message);
  else
    port.postMessage(message);
});
win.onMessage((message) => {
  message.origin = {
    context: "window",
    tabId: null
  };
  endpointRuntime.handleMessage(message);
});
port.onMessage(endpointRuntime.handleMessage);
port.onFailure((message) => {
  if (message.origin.context === "window") {
    win.postMessage({
      type: "error",
      transactionID: message.transactionId
    });
    return;
  }
  endpointRuntime.endTransaction(message.transactionId);
});
function allowWindowMessaging(nsps) {
  win.setNamespace(nsps);
  win.enable();
}
var { sendMessage, onMessage } = endpointRuntime;
var { openStream, onOpenStreamChannel } = createStreamWirings(endpointRuntime);
export {
  allowWindowMessaging,
  onMessage,
  onOpenStreamChannel,
  openStream,
  sendMessage
};
