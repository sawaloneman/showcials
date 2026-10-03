' Playback decisions only. No network, permissions or decoder access in this helper.
function VSPlaybackCommand(state as string, status as string, hold as boolean, target as double, position as double, duration as double) as string
    shouldPlay = status = "live" and not hold
    if state = "playing" and not shouldPlay then return "pause"
    if state = "paused" and shouldPlay then return "resume"
    if state = "finished"
        ' Do not loop when a delayed live anchor reaches the natural ending.
        boundary = duration
        if boundary <= 0 then boundary = position
        if boundary > 0 and target < boundary - 1.5 then return "restart"
    else if state = "stopped" or state = "none"
        if shouldPlay or target > 0 then return "restart"
    end if
    ' Buffering/stopping must settle. Errors require explicit user retry.
    return "none"
end function
