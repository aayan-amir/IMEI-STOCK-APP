package app.stockly.android;

import static org.junit.Assert.assertEquals;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppIdentityTest {
    @Test
    public void usesStocklyApplicationId() {
        assertEquals("app.stockly.android",
            InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName());
    }
}
