import os
import sys	

sys.path.insert(0, '/srv/www/htdocs/webdc3/wsgi/')

import webinterface

application = webinterface.application
