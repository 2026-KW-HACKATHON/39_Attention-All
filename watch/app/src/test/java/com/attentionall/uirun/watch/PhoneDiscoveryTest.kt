package com.attentionall.uirun.watch

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneDiscoveryTest {
    @Test
    fun hello_ack_during_probe_keeps_phone_connected() = runTest {
        var confirmed: String? = null
        val result = probePhoneConnection(listOf("phone"), { confirmed }) { confirmed = "phone" }
        assertEquals(Conn.CONNECTED to "phone", result)
    }

    @Test
    fun missing_app_and_disconnected_confirmed_phone_are_not_connected() = runTest {
        assertEquals(Conn.NO_APP to null, probePhoneConnection(listOf("phone"), { null }) {})
        assertEquals(Conn.NO_APP to null, probePhoneConnection(listOf("phone"), { "old-phone" }) {})
        assertEquals(Conn.NO_PHONE to null, probePhoneConnection(emptyList(), { "phone" }) { error("No node to probe") })
    }
}
