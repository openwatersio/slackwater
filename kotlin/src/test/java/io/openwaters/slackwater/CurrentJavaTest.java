package io.openwaters.slackwater;

import java.time.Instant;
import java.util.Collections;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CurrentJavaTest {
    @Test void existingConstructorsRemainAvailable() {
        Instant time = Instant.parse("2026-01-01T00:00:00Z");
        CurrentPoint point = new CurrentPoint(time, -3.0);
        assertEquals(3.0, point.getMagnitudeKnots());
        assertNull(point.getDirectionDegrees());
        CurrentPoint shifted = point.copy(time.plusSeconds(60), -3.0);
        assertEquals(time.plusSeconds(60), shifted.getTime());
        assertEquals(3.0, shifted.getMagnitudeKnots());
        CurrentStation station = new CurrentStation(Collections.emptyList(), 20.0, 205.0, -3.0);
        assertEquals(205.0, station.speeds(time, time.plusSeconds(3600), 600).get(0).getDirectionDegrees());
    }
}
