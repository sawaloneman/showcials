sub Main()
    m.failures = 0
    check("resume paused", VSPlaybackCommand("paused", "live", false, 2, 2, 24), "resume")
    check("pause on hold", VSPlaybackCommand("playing", "live", true, 2, 2, 24), "pause")
    check("pause on paused", VSPlaybackCommand("playing", "paused", false, 2, 2, 24), "pause")
    check("finished replay", VSPlaybackCommand("finished", "live", false, 0, 24, 24), "restart")
    check("finished seek back paused", VSPlaybackCommand("finished", "paused", false, 5, 24, 24), "restart")
    check("natural end no loop", VSPlaybackCommand("finished", "live", false, 24, 24, 24), "none")
    check("unknown duration fallback", VSPlaybackCommand("finished", "live", false, 1, 100, 0), "restart")
    check("buffering settles", VSPlaybackCommand("buffering", "live", false, 5, 3, 24), "none")
    check("decoder errors need retry", VSPlaybackCommand("error", "live", false, 5, 3, 24), "none")
    check("stopped live starts", VSPlaybackCommand("stopped", "live", false, 0, 0, 24), "restart")
    check("stopped paused zero stays", VSPlaybackCommand("stopped", "paused", false, 0, 0, 24), "none")
    check("stopped paused seek starts", VSPlaybackCommand("stopped", "paused", false, 5, 0, 24), "restart")
    print "POLICY_FAILURES="; m.failures.ToStr()
end sub
sub check(label as string, actual as string, expected as string)
    if actual <> expected
        m.failures = m.failures + 1
        print "FAIL "; label; ": "; actual; " expected "; expected
    else
        print "PASS "; label
    end if
end sub
