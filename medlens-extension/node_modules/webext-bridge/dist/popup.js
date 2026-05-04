import {
  createPersistentPort
} from "./chunk-E2HJRHOS.js";
import "./chunk-G7AOUSAZ.js";
import {
  createEndpointRuntime,
  createStreamWirings
} from "./chunk-QIZ4XBKF.js";
import "./chunk-REMFLVJH.js";

// src/popup.ts
var port = createPersistentPort("popup");
var endpointRuntime = createEndpointRuntime("popup", (message) => port.postMessage(message));
port.onMessage(endpointRuntime.handleMessage);
var { sendMessage, onMessage } = endpointRuntime;
var { openStream, onOpenStreamChannel } = createStreamWirings(endpointRuntime);
export {
  onMessage,
  onOpenStreamChannel,
  openStream,
  sendMessage
};
