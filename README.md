Advanced Looptimer for node-red

  

----------------------------

  

This project is based on **node-red-contrib-looptimer** and **node-red-contrib-looptimer2** with the need of overwrite properties via messages.

  

**Installation:**

> npm install node-red-contrib-looptimer-advanced

  

The main functionality is not changed (for now), however fix from looptimer2 has been implemented, because it did not work with other timers for example **node-red-contrib-stoptimer** and I've did some code rework for better functionality and cleaner code.

  

Sends the `msg` through the first output, then continues to do so in a loop, once per the timer duration specified, until a payload of `stop` or `STOP` is received, at which time the second output will automatically send a payload of `stopped`.
  
You can also stop the loop by specifying a maximum number of loops, which when reached, will stop the loop and timer, as well as sending a payload of `max loops reached` through the second output. Keep in mind, the first `msg` simply passes through, and is therefore not part of the loop. So if you set the max loops to `5`, you will get `6 messages`, which is 1 original message, and 5 messages from the loop.
  
Finally, to ensure you do not end up with an infinite loop, you can set a maximum timeout in seconds, minutes or hours, and when that time is reached, the loop and timer will also be stopped.
  
The properties can be overridden via `msg.loop` messages supplemented with property name. Accepted messages for loop are `msg.loop.duration` and `msg.loop.units`, for timeout are `msg.loop.maxtimeout` and `msg.loop.maxtimeoutunits`.

  


You can define maximum number of loops with `msg.loop.maxloops`

  

Setting the Max Loops and Max Timeout settings to high values can, for all intents, ensure that the loop can only be stopped by an incoming `stop` payload, however, the stability of the loop has not been tested over an extended number of hours.

  
**0.0.12** - Update README.md  
**0.0.11** - Add Type Check for Stop condition to avoid type error on non string payload converting to LowerCase  
**0.0.10** - Update README.md  
**0.0.9** - Bugfix for Minutes, and minor improvements to code quality  
**0.0.8** - Fix Until Node-Red Does Not Get Fixed on issue #3867  
**0.0.7** - Update Loop Dependency version as older version is not compatible with higher version Node.JS  
**0.0.6** - Added Example Flow and updated dependencies  
**0.0.5** - Re-added line removed accidentally  
**0.0.4** - Issue #4 -> Added message when timeout reached  
**0.0.1** - Initial Release  
  
**To Do:**  

- [ ] Mustache Template Support

- [x] Example Flows
