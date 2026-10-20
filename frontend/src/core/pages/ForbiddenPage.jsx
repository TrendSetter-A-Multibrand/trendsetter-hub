import { Button, Result } from 'antd'
import { Link } from 'react-router-dom'
import strings from '../strings.js'

export default function ForbiddenPage() {
  return (
    <div className="forbidden">
      <Result
        status="403"
        title="403"
        subTitle={strings.forbidden}
        extra={
          <Link to="/">
            <Button type="primary">{strings.toHome}</Button>
          </Link>
        }
      />
    </div>
  )
}
