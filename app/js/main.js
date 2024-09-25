'use strict'

import {enforceH264} from '../../shared/utils.js'

const localVid = document.getElementById('local-video')
const localLabel = document.getElementById('local-label')
const remoteVid = document.getElementById('remote-video')
const remoteLabel = document.getElementById('remote-label')
const currLatency = document.getElementById('curr-latency')
const startBtn = document.getElementById('start-button')

let localPc = null
let remotePc = null
let relayCandidatesGathered = false
let latencyPoller = null

let captureHeight = 480
let captureFrameRate = 60
let videoBitRate = 1_000_000

class IceServer {
    constructor(url, username = '', password = '') {
        this.urls = [url]
        this.username = username
        this.credential = password
    }
}
let iceServers = []

function extractIceServerParams(params, prefix) {
    if (!params.has(prefix))
        return null

    let url = params.get(prefix)
    if (!url.startsWith(prefix + ':'))
        url = `${prefix}:${url}`
    let server = new IceServer(url)

    if (params.has(prefix + 'User'))
        server.username = params.get(prefix + 'User')
    if (params.has(prefix + 'Pwd'))
        server.credential = params.get(prefix + 'Pwd')

    return server
}

window.onload = () => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('turn') || !params.has('turnUser') || !params.has('turnPwd')) {
        alert('TURN server (or user/pwd) not provided. Expected URL params: turn=example.com:1234&turnUser=me&turnPwd=qwerty&stun=example.com:1234 (stun, stunUser and stunPwd are optional)')
        return
    }

    const stun = extractIceServerParams(params, 'stun')
    if (stun)
        iceServers.push(stun)

    iceServers.push(extractIceServerParams(params, 'turn'))

    if (params.has('height'))
        captureHeight = params.get('height') | 0
    if (params.has('fps'))
        captureFrameRate = params.get('fps') | 0
    if (params.has('bitrate'))
        videoBitRate = params.get('bitrate') | 0

    console.log(`getDisplayMedia-requested height: ${captureHeight} pix, fps: ${captureFrameRate}, WebRTC video bit rate: ${videoBitRate / 1000} kbps`)
    console.log('Sample URL params for resolution, frame rate and bit rate: height=720&fps=10&bitrate=300000')

    startBtn.disabled = false
}

function addIceCandidate(pc, candidate) {
    if (!pc || !localPc || !remotePc)
        return

    if (!candidate || candidate.type === 'relay') {
        pc.addIceCandidate(candidate)
        if (candidate)
            relayCandidatesGathered = true
    }

    const tag = `ICE ${pc === localPc ? 'remote -> local' : 'local -> remote'}`
    if (candidate)
        console.log(`[${tag}] ${candidate.type} / ${candidate.address}`)
    else {
        console.log(`[${tag}] done gathering candidates`)
        if (!relayCandidatesGathered) {
            stop()
            alert('Failed to gather relay candidates, STUN/TURN is misconfigured or down')
        }
    }
}

async function start() {
    startBtn.style.display = 'none'
    localVid.style.display = 'block'
    localLabel.style.display = 'block'
    remoteVid.style.display = 'block'
    remoteLabel.innerHTML = 'Remote (connecting):'
    remoteLabel.style.display = 'block'

    remoteVid.addEventListener('resize', () => {
        if (remoteVid.videoWidth) {
            console.log(`Resolution changed: ${remoteVid.videoWidth}x${remoteVid.videoHeight}`)
            currLatency.style.display = 'block'
            remoteLabel.innerHTML = 'Remote:'
        }
    })

    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({video: {
            height: {ideal: captureHeight},
            frameRate: {ideal: captureFrameRate}
        }})
        localVid.srcObject = stream

        const pcConfig = {
            //encodedInsertableStreams: true,
            iceServers,
            iceTransportPolicy: 'relay'
        }
        localPc = new RTCPeerConnection(pcConfig)
        remotePc = new RTCPeerConnection(pcConfig)
        relayCandidatesGathered = false

        localPc.addTrack(stream.getVideoTracks()[0], stream)
        const transceivers = localPc.getTransceivers()
        for (const tr of transceivers) {
            tr.direction = 'sendonly'
            //setupSenderTransform(tr.sender)

            if (tr.sender.track.kind === 'video') {
                // prevent resolution switching
                let params = tr.sender.getParameters()
                params.degradationPreference = 'maintain-resolution'

                if (!params.encodings)
                    params.encodings = [{}]

                params.encodings[0].maxBitrate = videoBitRate
                params.encodings[0].minBitrate = videoBitRate >> 2

                await tr.sender.setParameters(params)
            }
        }

        remotePc.ontrack = e => {
            //setupReceiverTransform(e.transceiver.receiver)
            remoteVid.srcObject = e.streams[0]
        }

        localPc.onicecandidate = e => addIceCandidate(remotePc, e.candidate)
        remotePc.onicecandidate = e => addIceCandidate(localPc, e.candidate)

        const localOffer = await localPc.createOffer()
        // force H264 by means of removing other video codecs from the SDP
        localOffer.sdp = enforceH264(localOffer.sdp)
        await localPc.setLocalDescription(localOffer)

        await remotePc.setRemoteDescription(localOffer)
        const remoteAnswer = await remotePc.createAnswer()
        await remotePc.setLocalDescription(remoteAnswer)

        localPc.setRemoteDescription(remoteAnswer)

        latencyPoller = setInterval(() => {
            // coming up soon
            let latencyMs = 0
            currLatency.innerText = `Latency: ${latencyMs}ms`
        }, 2000)
    }
    catch (e) {
        stop()
        alert(`${e}`)
    }
}
window.start = start

function stop() {
    startBtn.style.display = 'block'
    localVid.style.display = 'none'
    localLabel.style.display = 'none'
    remoteVid.style.display = 'none'
    remoteLabel.style.display = 'none'
    currLatency.style.display = 'none'

    localVid.srcObject = null
    remoteVid.srcObject = null

    if (localPc) {
        localPc.close()
        localPc = null
    }

    if (remotePc) {
        remotePc.close()
        remotePc = null
    }

    if (latencyPoller) {
        clearInterval(latencyPoller)
        latencyPoller = null
    }
}
