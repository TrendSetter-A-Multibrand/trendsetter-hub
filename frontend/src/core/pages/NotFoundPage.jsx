import { Button, Result } from 'antd'
import { Link } from 'react-router-dom'
import strings from '../strings.js'

export default function NotFoundPage() {
  return (
    <Result
      status="404"
      title="404"
      subTitle={strings.notFound}
      extra={
        <Link to="/">
          <Button type="primary">{strings.toHome}</Button>
        </Link>
      }
    />
  )
}
