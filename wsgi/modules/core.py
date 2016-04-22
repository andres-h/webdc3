import os

class WI_Module(object):
    def __init__(self, wi):
        self.js_conf = wi.getConfigJSON('js')
        wi.registerAction("/configuration", self.configuration)
        wi.registerAction("/loader", self.loaderjs)

        # We keep a copy of it
        self.__wi = wi

    def configuration(self, envir, params):
        """Read the configuration file and return the variables in JSON format.
        Input: nothing
        Output: All js.* variables of webinterface.cfg in JSON format
        Begun by Andres Heinloo <andres@gfz-potsdam.de>, GEOFON team, June 2013

        """
        return [ self.js_conf ]

    def loaderjs(self, envir, params):
        """It returns the Javascript code to load the loader.js file in the main page.
        Begun by Marcelo Bianchi <mbianchi@gfz-potsdam.de>, GEOFON team, June 2013

        """

        body = []

        # Create the variables that are returned in Javascript format based on the
        # information of the environment.
        body.append("window.eidaJSSource='%s';"  % (os.path.dirname(envir['SCRIPT_NAME']) + '/js'))
        body.append("window.eidaCSSSource='%s';" % (os.path.dirname(envir['SCRIPT_NAME']) + '/css'))
        body.append("window.eidaServiceRoot='%s';" % (envir['SCRIPT_NAME']))
        debug = ( "true" if self.__wi.getConfigInt('DEBUG', 0) == 1 else "false" )
        body.append("window.eidaDebug=" + debug + ";")
        body.append("$(document).ready(function() { $.getScript(eidaJSSource + '/webdc3.min.js') });")

        return body

