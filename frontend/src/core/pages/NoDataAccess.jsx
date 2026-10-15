import { Alert } from 'antd'
import strings from '../strings.js'

export default function NoDataAccess() {
  return <Alert type="info" showIcon title={strings.noDataAccess} />
}
