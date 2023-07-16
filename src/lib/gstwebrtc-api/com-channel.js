/*
 * gstwebrtc-api
 *
 * Copyright (C) 2022 Igalia S.L. <info@igalia.com>
 *   Author: Loïc Le Page <llepage@igalia.com>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import ConsumerSession from './consumer-session'

const SignallingServerMessageType = Object.freeze({
    welcome: 'welcome',
    peerStatusChanged: 'peerStatusChanged',
    list: 'list',
    sessionStarted: 'sessionStarted',
    peer: 'peer',
    startSession: 'startSession',
    endSession: 'endSession',
    error: 'error',
})

function normalizeProducer(producer, excludedId) {
    if (!producer || typeof producer !== 'object') {
        return null
    }

    const normalizedProducer = {
        id: '',
        meta: {},
    }

    if (producer.id && typeof producer.id === 'string') {
        normalizedProducer.id = producer.id
    } else if (producer.peerId && typeof producer.peerId === 'string') {
        normalizedProducer.id = producer.peerId
    } else {
        return null
    }

    if (normalizedProducer.id === excludedId) {
        return null
    }

    if (producer.meta && typeof producer.meta === 'object') {
        normalizedProducer.meta = producer.meta
    }

    Object.freeze(normalizedProducer.meta)
    return Object.freeze(normalizedProducer)
}

export default class ComChannel extends EventTarget {
    constructor(url, meta, webrtcConfig) {
        super()

        this._meta = meta
        this._webrtcConfig = webrtcConfig
        this._ws = new WebSocket(url)
        this._ready = false
        this._channelId = ''
        this._consumerSessions = {}

        this._connectionTimeout = window.setTimeout(() => {
            this.close()
        }, 2000)

        this._ws.onopen = () => {
            window.clearTimeout(this._connectionTimeout)
        }

        this._ws.onerror = (event) => {
            this.dispatchEvent(
                new ErrorEvent('error', {
                    message: event.message || 'WebSocket error',
                    error:
                        event.error ||
                        new Error(
                            this._ready
                                ? 'transportation error'
                                : 'cannot connect to signaling server'
                        ),
                })
            )
            this.close()
        }

        this._ws.onclose = () => {
            this._ready = false
            this._channelId = ''
            this._ws = null

            this.closeAllConsumerSessions()

            this.dispatchEvent(new Event('closed'))
        }

        this._ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data)
                if (msg && typeof msg === 'object') {
                    switch (msg.type) {
                        case SignallingServerMessageType.welcome:
                            this._channelId = msg.peerId
                            try {
                                this._ws.send(
                                    JSON.stringify({
                                        type: 'setPeerStatus',
                                        roles: ['listener'],
                                        meta: meta,
                                    })
                                )
                            } catch (ex) {
                                this.dispatchEvent(
                                    new ErrorEvent('error', {
                                        message:
                                            'cannot initialize connection to signaling server',
                                        error: ex,
                                    })
                                )
                                this.close()
                            }
                            break

                        case SignallingServerMessageType.peerStatusChanged:
                            if (msg.peerId === this._channelId) {
                                if (
                                    !this._ready &&
                                    msg.roles.includes('listener')
                                ) {
                                    this._ready = true
                                    this.dispatchEvent(new Event('ready'))
                                    this.send({ type: 'list' })
                                }
                            } else {
                                const normalizedProducer = normalizeProducer(
                                    msg,
                                    this._channelId
                                )
                                if (normalizedProducer) {
                                    if (msg.roles.includes('producer')) {
                                        this.dispatchEvent(
                                            new CustomEvent('producerAdded', {
                                                detail: normalizedProducer,
                                            })
                                        )
                                    } else {
                                        this.dispatchEvent(
                                            new CustomEvent('producerRemoved', {
                                                detail: normalizedProducer,
                                            })
                                        )
                                    }
                                }
                            }
                            break

                        case SignallingServerMessageType.list:
                            for (const producer of msg.producers) {
                                const normalizedProducer = normalizeProducer(
                                    producer,
                                    this._channelId
                                )
                                if (normalizedProducer) {
                                    this.dispatchEvent(
                                        new CustomEvent('producerAdded', {
                                            detail: normalizedProducer,
                                        })
                                    )
                                }
                            }
                            break

                        case SignallingServerMessageType.sessionStarted:
                            {
                                const session = this.getConsumerSession(
                                    msg.peerId
                                )
                                if (session) {
                                    delete this._consumerSessions[msg.peerId]

                                    session.onSessionStarted(
                                        msg.peerId,
                                        msg.sessionId
                                    )
                                    if (
                                        session.sessionId &&
                                        !(
                                            session.sessionId in
                                            this._consumerSessions
                                        )
                                    ) {
                                        this._consumerSessions[
                                            session.sessionId
                                        ] = session
                                    } else {
                                        session.close()
                                    }
                                }
                            }
                            break

                        case SignallingServerMessageType.peer:
                            {
                                const session = this.getConsumerSession(
                                    msg.sessionId
                                )
                                if (session) {
                                    session.onSessionPeerMessage(msg)
                                }
                            }
                            break

                        case SignallingServerMessageType.startSession:
                            break

                        case SignallingServerMessageType.endSession:
                            {
                                const session = this.getConsumerSession(
                                    msg.sessionId
                                )
                                if (session) {
                                    session.close()
                                }
                            }
                            break

                        case SignallingServerMessageType.error:
                            this.dispatchEvent(
                                new ErrorEvent('error', {
                                    message:
                                        'error received from signaling server',
                                    error: new Error(msg.details),
                                })
                            )
                            break

                        default:
                            throw new Error(
                                `unknown message type: "${msg.type}"`
                            )
                    }
                }
            } catch (ex) {
                this.dispatchEvent(
                    new ErrorEvent('error', {
                        message:
                            'cannot parse incoming message from signaling server',
                        error: ex,
                    })
                )
            }
        }
    }

    get meta() {
        return this._meta
    }

    get webrtcConfig() {
        return this._webrtcConfig
    }

    get ready() {
        return this._ready
    }

    get channelId() {
        return this._channelId
    }

    createConsumerSession(producerId) {
        if (!this._ready || !producerId || typeof producerId !== 'string') {
            return null
        }

        if (producerId in this._consumerSessions) {
            return this._consumerSessions[producerId]
        }

        for (const session of Object.values(this._consumerSessions)) {
            if (session.peerId === producerId) {
                return session
            }
        }

        const session = new ConsumerSession(producerId, this)
        this._consumerSessions[producerId] = session

        session.addEventListener('closed', (event) => {
            let sessionId = event.target.sessionId
            if (!sessionId) {
                sessionId = event.target.peerId
            }

            if (
                sessionId in this._consumerSessions &&
                this._consumerSessions[sessionId] === session
            ) {
                delete this._consumerSessions[sessionId]
            }
        })

        return session
    }

    getConsumerSession(sessionId) {
        if (sessionId in this._consumerSessions) {
            return this._consumerSessions[sessionId]
        } else {
            return null
        }
    }

    closeAllConsumerSessions() {
        for (const session of Object.values(this._consumerSessions)) {
            session.close()
        }

        this._consumerSessions = {}
    }

    send(data) {
        if (this._ready && data && typeof data === 'object') {
            try {
                this._ws.send(JSON.stringify(data))
                return true
            } catch (ex) {
                this.dispatchEvent(
                    new ErrorEvent('error', {
                        message: 'cannot send message to signaling server',
                        error: ex,
                    })
                )
            }
        }

        return false
    }

    close() {
        if (this._ws) {
            this._ready = false
            this._channelId = ''
            this._ws.close()

            this.closeAllConsumerSessions()
        }
    }
}
