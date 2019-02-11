# hyperpeer
hyperpeer is the javascript module for implementing browser peers in applications based on Hyperpeer.
This module provides a single class called [`Hyperpeer`](#Hyperpeer) which manages both the connection 
with the signaling server and the peer-to-peer communication via WebRTC with remote peers.

# Features

* Simple node.js style API.
* Based on the popular modules [simple-peer](https://github.com/feross/simple-peer/), [ws](https://github.com/websockets/ws), 
and [EventEmitter2](https://www.npmjs.com/package/eventemitter2).
* Works in the browser with [browserify](http://browserify.org/).

# Example
```js
const Hyperpeer = require('hyperpeer')
const serverAddress = 'ws://localhost:8080';

let video = document.getElementById('video');

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
.then((stream) => {
    let hp = new Hyperpeer(serverAddress, { 
        id: 'id1', 
        type: 'type1',
        stream: stream,
        videoElement: video
    });
    hp.on('online', () => {
        hp.getPeers()
        .then((peers) => {
            if (peers.length) {
                return hp.connectTo(peers[0].id)
            }
            hp.on('connection', hp.acceptConnection);
            return hp.listenConnections()
        })
        .catch((error) => { alert(error) })
    })

    hp.on('connect', () => {
        console.log('Peer-to-peer connection established!')
        hp.send('ciao')
    })

    hp.on('data', (data) => {
        console.log('Remote peer says: ' + data)
    })

    hp.on('error', (error) => {
        alert('Hyperpeer Error: ' + error)
    })
})
.catch((error) => {
    alert('mediaDevices error: ' + error)
}); 

 ```

# API Reference

<a name="Hyperpeer"></a>

## Hyperpeer ⇐ <code>EventEmitter2</code>
**Kind**: global class  
**Extends**: <code>EventEmitter2</code>  
**Emits**: [<code>online</code>](#Hyperpeer+event_online), [<code>error</code>](#Hyperpeer+event_error), [<code>close</code>](#Hyperpeer+event_close), [<code>connection</code>](#Hyperpeer+event_connection), [<code>connect</code>](#Hyperpeer+event_connect), [<code>disconnect</code>](#Hyperpeer+event_disconnect), [<code>stream</code>](#Hyperpeer+event_stream), [<code>data</code>](#Hyperpeer+event_data)  

* [Hyperpeer](#Hyperpeer) ⇐ <code>EventEmitter2</code>
    * [new Hyperpeer(serverAddress, options)](#new_Hyperpeer_new)
    * _instance_
        * [.readyState](#Hyperpeer+readyState) : <code>string</code>
        * [.close()](#Hyperpeer+close)
        * [.getPeers()](#Hyperpeer+getPeers) ⇒ <code>Promise.&lt;Array.&lt;Hyperpeer~peer&gt;&gt;</code>
        * [.connectTo(remotePeerId)](#Hyperpeer+connectTo) ⇒ <code>Promise</code>
        * [.acceptConnection()](#Hyperpeer+acceptConnection) ⇒ <code>Promise</code>
        * [.listenConnections()](#Hyperpeer+listenConnections) ⇒ <code>Promise</code>
        * [.disconnect()](#Hyperpeer+disconnect) ⇒ <code>Promise</code>
        * [.send(data)](#Hyperpeer+send) ⇒ <code>Promise</code>
        * ["online"](#Hyperpeer+event_online)
        * ["error"](#Hyperpeer+event_error)
        * ["close"](#Hyperpeer+event_close)
        * ["connection"](#Hyperpeer+event_connection)
        * ["connect"](#Hyperpeer+event_connect)
        * ["disconnect"](#Hyperpeer+event_disconnect)
        * ["stream"](#Hyperpeer+event_stream)
        * ["data"](#Hyperpeer+event_data)
    * _static_
        * [.states](#Hyperpeer.states) : <code>enum</code>
    * _inner_
        * [~peer](#Hyperpeer..peer) : <code>Object</code>

<a name="new_Hyperpeer_new"></a>

### new Hyperpeer(serverAddress, options)
An instance of the Hyperpeer class is an [EventEmitter](https://www.npmjs.com/package/eventemitter2) that represents the local peer in a WebRTC application based in Hyperpeer.
Hyperpeer instances manages both the connection with the signaling server and the peer-to-peer communication via WebRTC with remote peers.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| serverAddress | <code>string</code> |  | URL of the Hyperpeer signaling server, it should include the protocol prefix 'ws://' or 'wss//' that specify the websocket protocol to use. |
| options | <code>Object</code> |  | Peer settings |
| [options.type] | <code>string</code> | <code>&quot;browser&quot;</code> | Peer type. It can be used by other peers to know the role of the peer in the current application. |
| [options.id] | <code>string</code> |  | Peer unique identification string. Must be unique among all connected peers. If it's undefined or null, the server will assign a random string. |
| [options.key] | <code>string</code> |  | Peer validation string. It may be used by the server to verify the peer. |
| [options.videoElement] | <code>Object</code> |  | Video tag element that will be used as sink of the incoming media stream. |
| [options.stream] | <code>Object</code> |  | [MediaStream](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream) object that will be sent to the remote peer. |

<a name="Hyperpeer+readyState"></a>

### hyperpeer.readyState : <code>string</code>
State of the peer instance. It may have one of the values specified in [Hyperpeer.states](Hyperpeer#states)

**Kind**: instance property of [<code>Hyperpeer</code>](#Hyperpeer)  
**Read only**: true  
<a name="Hyperpeer+close"></a>

### hyperpeer.close()
Close the connection with the signaling server and with any remote peer.

**Kind**: instance method of [<code>Hyperpeer</code>](#Hyperpeer)  
<a name="Hyperpeer+getPeers"></a>

### hyperpeer.getPeers() ⇒ <code>Promise.&lt;Array.&lt;Hyperpeer~peer&gt;&gt;</code>
Returns a promise that resolve with the list of peers currently connected to the signaling server.

**Kind**: instance method of [<code>Hyperpeer</code>](#Hyperpeer)  
<a name="Hyperpeer+connectTo"></a>

### hyperpeer.connectTo(remotePeerId) ⇒ <code>Promise</code>
Request a peer-to-peer connection with a remote peer.

**Kind**: instance method of [<code>Hyperpeer</code>](#Hyperpeer)  

| Param | Type | Description |
| --- | --- | --- |
| remotePeerId | <code>string</code> | id of the remote peer to connect to. |

<a name="Hyperpeer+acceptConnection"></a>

### hyperpeer.acceptConnection() ⇒ <code>Promise</code>
Accept an incoming connection from a remote peer. You should call to the [listenConnections](#Hyperpeer+listenConnections) method first.

**Kind**: instance method of [<code>Hyperpeer</code>](#Hyperpeer)  
<a name="Hyperpeer+listenConnections"></a>

### hyperpeer.listenConnections() ⇒ <code>Promise</code>
Wait for incoming connections.

**Kind**: instance method of [<code>Hyperpeer</code>](#Hyperpeer)  
<a name="Hyperpeer+disconnect"></a>

### hyperpeer.disconnect() ⇒ <code>Promise</code>
Drop a current connection with a remote peer.

**Kind**: instance method of [<code>Hyperpeer</code>](#Hyperpeer)  
<a name="Hyperpeer+send"></a>

### hyperpeer.send(data) ⇒ <code>Promise</code>
Send a message to the connected remote peer using the established WebRTC data channel.

**Kind**: instance method of [<code>Hyperpeer</code>](#Hyperpeer)  

| Param | Type |
| --- | --- |
| data | <code>\*</code> | 

<a name="Hyperpeer+event_online"></a>

### "online"
Online event. Emitted when successfully connected to the signaling server.

**Kind**: event emitted by [<code>Hyperpeer</code>](#Hyperpeer)  
<a name="Hyperpeer+event_error"></a>

### "error"
Error event.

**Kind**: event emitted by [<code>Hyperpeer</code>](#Hyperpeer)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| error | <code>object</code> | Error object. |

<a name="Hyperpeer+event_close"></a>

### "close"
Close event. Emitted when disconnected from the signaling server.

**Kind**: event emitted by [<code>Hyperpeer</code>](#Hyperpeer)  
<a name="Hyperpeer+event_connection"></a>

### "connection"
Connection event. Emitted when a connection request is received.

**Kind**: event emitted by [<code>Hyperpeer</code>](#Hyperpeer)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| details | <code>object</code> |  |
| details.remotePeerId | <code>string</code> | id of the remote peer that request the connection. |

<a name="Hyperpeer+event_connect"></a>

### "connect"
Connect event. Emitted when a WebRTC connection is successfully established with the remote peer.

**Kind**: event emitted by [<code>Hyperpeer</code>](#Hyperpeer)  
<a name="Hyperpeer+event_disconnect"></a>

### "disconnect"
Disconnect event. Emitted when disconnected from the remote peer.

**Kind**: event emitted by [<code>Hyperpeer</code>](#Hyperpeer)  
<a name="Hyperpeer+event_stream"></a>

### "stream"
Stream event. Emitted when a [MediaStream](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream) is received from the remote peer.

**Kind**: event emitted by [<code>Hyperpeer</code>](#Hyperpeer)  
**Properties**

| Type | Description |
| --- | --- |
| <code>object</code> | [MediaStream](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream) object |

<a name="Hyperpeer+event_data"></a>

### "data"
Data event. Emitted when a data channel message is received from the remote peer.

**Kind**: event emitted by [<code>Hyperpeer</code>](#Hyperpeer)  
**Properties**

| Type | Description |
| --- | --- |
| <code>\*</code> | Data |

<a name="Hyperpeer.states"></a>

### Hyperpeer.states : <code>enum</code>
Possible values of readyState

**Kind**: static enum of [<code>Hyperpeer</code>](#Hyperpeer)  
**Read only**: true  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| STARTING | <code>string</code> | connecting to signaling server |
| ONLINE | <code>string</code> | connected to signaling server but not paired to any peer |
| CONNECTING | <code>string</code> | pairing and establishing a WebRTC connection with peer |
| CONNECTED | <code>string</code> | WebRTC peer connection and data channel are ready |
| DISCONNECTING | <code>string</code> | closing peer connection |
| LISTENING | <code>string</code> | waiting for incoming connections |
| CLOSING | <code>string</code> | disconnecting from signaling server |
| CLOSED | <code>string</code> | disconnected from signaling server and not longer usable |

<a name="Hyperpeer..peer"></a>

### Hyperpeer~peer : <code>Object</code>
Element of the list of peers.

**Kind**: inner typedef of [<code>Hyperpeer</code>](#Hyperpeer)  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>string</code> | id of the peer. |
| type | <code>string</code> | type of the peer. |
| busy | <code>boolean</code> | Indicates whether the peer is paired and comunicating with another peer. |

