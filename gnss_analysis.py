import pandas as pd
import numpy as np
from pyproj import Transformer

df = pd.read_csv("uncorrected150m.csv")
transformer = Transformer.from_crs(
    "EPSG:4326", "EPSG:32616", always_xy = True
    )
x, y = transformer.transform(
    df["Longitude"].to_numpy(),
    df["Latitude"].to_numpy()
    )
x_mean =np.mean(x)
y_mean =np.mean(y)

distance_cm = np.sqrt(
    (x - x_mean)**2 + (y - y_mean)**2
    )*100
print("Measurements:",len(df))
print("Standard Deviation (cm):",
      np.std(distance_cm, ddof=1))
print("Variance (cm^2): ",
      np.var(distance_cm, ddof=1))
print("Maximum Distance from Mean(cm): ",
      np.max(distance_cm))

if np.all(distance_cm <= 10):
    print(" PASS: All points within 10 cm of mean")
else:
        print("FAIL: Some points exceed 10 cm")
import matplotlib.pyplot as plt
plt.hist(distance_cm, bins = 10, edgecolor = "black")
plt.axvline(10, color ="red", linestyle="--",
            label = "10 cm requirement")
plt.xlabel("Distance from mean (cm)")
plt.ylabel("Trials")
plt.title("GNSS Position Error Distribution")
plt.legend()
plt.grid(True)

plt.show()
