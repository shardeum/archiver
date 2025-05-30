import * as P2P from '../P2P'
import * as Logger from '../Logger'
import * as NodeList from '../NodeList'
import { config } from '../Config'
import { DataRequest, DataRequestTypes } from './types'

export async function sendDataRequest(
  nodeInfo: NodeList.ConsensusNodeInfo,
  requestType: DataRequestTypes[keyof DataRequestTypes]
): Promise<boolean> {
  const dataRequest: DataRequest = {
    subscriber_id: config.ARCHIVER_PUBLIC_KEY,
    data: requestType,
  }
  const REQUEST_NETCONFIG_TIMEOUT_SECOND = 2
  let response = null
  try {
    response = await P2P.postJson(
      `http://${nodeInfo.ip}:${nodeInfo.port}/subscribe`,
      dataRequest,
      REQUEST_NETCONFIG_TIMEOUT_SECOND
    )
  } catch (error) {
    if (error.message && error.message.includes('ECONNREFUSED')) {
      Logger.mainLogger.warn(`Unable to connect to node ${nodeInfo.ip}:${nodeInfo.port}: ${error.message}`)
    } else {
      Logger.mainLogger.error(`Error sending data request to node ${nodeInfo.ip}:${nodeInfo.port}: ${error}`)
    }
    return false
  }
  if (response.success) {
    Logger.mainLogger.debug(
      `${requestType} request sent to node ${nodeInfo.publicKey}. Response: ${JSON.stringify(response)}`
    )
    return true
  } else {
    Logger.mainLogger.warn(
      `${requestType} request failed for node ${nodeInfo.publicKey}. Response: ${JSON.stringify(response)}`
    )
    return false
  }
}