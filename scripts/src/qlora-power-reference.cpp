/*
 * Independent, offline C++17 Monte Carlo reference for the four synthetic
 * QLoRA preflight vectors in lib/ai-evaluation/src/index.test.ts.
 *
 * Build and run:
 *   c++ -std=c++17 -O3 scripts/src/qlora-power-reference.cpp \
 *     -o /tmp/qlora-power-reference
 *   /tmp/qlora-power-reference
 *
 * This program uses only the standard library. It has no provider, network,
 * filesystem-input, or customer-data access. See
 * docs/evidence/conditional-qlora-promotion-bar-2026-10-02.md for the
 * statistical method and the compiler/runtime used to verify the fixtures.
 */

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <random>
#include <string>
#include <vector>

namespace {

constexpr std::uint64_t kSeedBase = 20261002;
constexpr std::uint64_t kReferenceReplicates = 1'000'000;
constexpr std::uint64_t kQualificationTrials = 5'000;
constexpr double kOverallMarginPercentagePoints = 5.0;
constexpr double kCriticalMarginPercentagePoints = 3.0;
constexpr double kOneSided95NormalZ = 1.6448536269514722;
constexpr double kTwoSided95WilsonZ = 1.959963984540054;
constexpr double kRateEpsilon = 1e-12;
constexpr std::size_t kMaximumCheckedBrandCount = 102;

struct Brand {
  std::size_t case_count;
  std::size_t overall_field_gains_per_case;
  std::size_t critical_field_gain_cases;

  double overall_gain_sum() const {
    return static_cast<double>(case_count * overall_field_gains_per_case) / 100.0;
  }

  double critical_gain_sum() const {
    return static_cast<double>(critical_field_gain_cases) / 20.0;
  }
};

struct Vector {
  std::string name;
  std::vector<Brand> brands;
  std::vector<std::size_t> fixture_counts_to_report;
};

struct MetricTotals {
  double gain_sum = 0.0;
  double gain_squared_sum = 0.0;
  double gain_case_product_sum = 0.0;
  double case_squared_sum = 0.0;
};

struct PowerPoint {
  double overall;
  double critical;
  bool qualifies;
};

std::vector<Vector> make_vectors() {
  return {
      {
          "balanced brands with low variance and gains comfortably above both margins",
          {
              {10, 7, 8}, {10, 8, 9}, {10, 9, 10}, {10, 7, 9},
              {10, 8, 8}, {10, 9, 9}, {10, 7, 10}, {10, 8, 9},
              {10, 9, 8}, {10, 7, 9}, {10, 8, 10}, {10, 9, 9},
              {10, 7, 8}, {10, 8, 9}, {10, 9, 10}, {10, 8, 9},
          },
          {2},
      },
      {
          "uneven low-variance brands with gains close to both margins",
          {
              {10, 5, 6}, {10, 6, 7}, {10, 6, 7}, {10, 7, 8},
              {10, 6, 7}, {10, 7, 8}, {10, 5, 7}, {10, 6, 7},
              {20, 5, 12}, {20, 6, 14}, {20, 6, 13}, {20, 7, 15},
              {20, 6, 14}, {20, 7, 15}, {20, 5, 13}, {20, 6, 14},
          },
          {3, 4, 5},
      },
      {
          "balanced high-variance brands with both gains close to their margins",
          {
              {10, 1, 10}, {10, 12, 10}, {10, 2, 10}, {10, 11, 10},
              {10, 3, 10}, {10, 10, 10}, {10, 1, 10}, {10, 12, 10},
              {10, 2, 10}, {10, 11, 10}, {10, 3, 10}, {10, 10, 10},
              {10, 1, 0}, {10, 12, 0}, {10, 2, 2}, {10, 11, 2},
              {10, 3, 3}, {10, 10, 3}, {10, 1, 5}, {10, 12, 5},
          },
          {96, 97, 98, 99, 100, 101, 102},
      },
      {
          "uneven high-variance brands with gains close to both margins",
          {
              {5, 12, 4}, {5, 11, 5}, {5, 12, 3}, {5, 11, 4},
              {5, 12, 5}, {5, 11, 3}, {5, 12, 4}, {5, 11, 5},
              {5, 12, 3}, {5, 11, 4}, {20, 5, 14}, {20, 5, 15},
              {20, 5, 13}, {20, 5, 14}, {20, 5, 15}, {20, 5, 13},
              {20, 5, 14}, {20, 5, 15}, {20, 5, 13}, {20, 5, 14},
          },
          {9, 10, 11},
      },
  };
}

double cluster_normal_lower_bound(
    const MetricTotals& totals,
    double case_count,
    std::size_t sampled_brand_count) {
  const double estimate = totals.gain_sum / case_count;
  const double residual_sum_squares = std::max(
      0.0,
      totals.gain_squared_sum
          - 2.0 * estimate * totals.gain_case_product_sum
          + estimate * estimate * totals.case_squared_sum);
  const double residual_variance =
      residual_sum_squares / static_cast<double>(std::max<std::size_t>(1, sampled_brand_count - 1));
  const double standard_error = std::sqrt(
      (static_cast<double>(sampled_brand_count) * residual_variance)
      / (case_count * case_count));
  return estimate - kOneSided95NormalZ * standard_error;
}

double wilson_lower_bound(std::uint64_t successes, std::uint64_t trials) {
  const double n = static_cast<double>(trials);
  const double observed = static_cast<double>(successes) / n;
  const double z_squared = kTwoSided95WilsonZ * kTwoSided95WilsonZ;
  const double denominator = 1.0 + z_squared / n;
  const double center = observed + z_squared / (2.0 * n);
  const double margin = kTwoSided95WilsonZ * std::sqrt(
      (observed * (1.0 - observed) / n)
      + (z_squared / (4.0 * n * n)));
  return (center - margin) / denominator;
}

std::uint64_t project_to_qualification_trials(double estimated_power) {
  return static_cast<std::uint64_t>(
      std::llround(estimated_power * static_cast<double>(kQualificationTrials)));
}

std::vector<PowerPoint> simulate(const Vector& vector) {
  std::vector<std::uint64_t> overall_successes(kMaximumCheckedBrandCount + 1, 0);
  std::vector<std::uint64_t> critical_successes(kMaximumCheckedBrandCount + 1, 0);
  const std::size_t case_total = [&vector]() {
    std::size_t total = 0;
    for (const Brand& brand : vector.brands) total += brand.case_count;
    return total;
  }();
  std::mt19937_64 random(kSeedBase + case_total);
  std::uniform_int_distribution<std::size_t> choose_brand(0, vector.brands.size() - 1);

  for (std::uint64_t replicate = 0; replicate < kReferenceReplicates; ++replicate) {
    MetricTotals overall;
    MetricTotals critical;
    double cases = 0.0;

    for (std::size_t brand_count = 1; brand_count <= kMaximumCheckedBrandCount; ++brand_count) {
      const Brand& brand = vector.brands[choose_brand(random)];
      const double brand_cases = static_cast<double>(brand.case_count);
      const double overall_gain = brand.overall_gain_sum();
      const double critical_gain = brand.critical_gain_sum();
      cases += brand_cases;

      overall.gain_sum += overall_gain;
      overall.gain_squared_sum += overall_gain * overall_gain;
      overall.gain_case_product_sum += overall_gain * brand_cases;
      overall.case_squared_sum += brand_cases * brand_cases;

      critical.gain_sum += critical_gain;
      critical.gain_squared_sum += critical_gain * critical_gain;
      critical.gain_case_product_sum += critical_gain * brand_cases;
      critical.case_squared_sum += brand_cases * brand_cases;

      if (brand_count < 2) continue;

      const double overall_lower = cluster_normal_lower_bound(overall, cases, brand_count);
      const double critical_lower = cluster_normal_lower_bound(critical, cases, brand_count);
      if (overall_lower * 100.0 > kOverallMarginPercentagePoints + kRateEpsilon) {
        ++overall_successes[brand_count];
      }
      if (critical_lower * 100.0 > kCriticalMarginPercentagePoints + kRateEpsilon) {
        ++critical_successes[brand_count];
      }
    }
  }

  std::vector<PowerPoint> curve(kMaximumCheckedBrandCount + 1, {0.0, 0.0, false});
  for (std::size_t brand_count = 2; brand_count <= kMaximumCheckedBrandCount; ++brand_count) {
    const double overall =
        static_cast<double>(overall_successes[brand_count]) / static_cast<double>(kReferenceReplicates);
    const double critical =
        static_cast<double>(critical_successes[brand_count]) / static_cast<double>(kReferenceReplicates);
    const auto projected_overall = project_to_qualification_trials(overall);
    const auto projected_critical = project_to_qualification_trials(critical);
    curve[brand_count] = {
        overall,
        critical,
        wilson_lower_bound(projected_overall, kQualificationTrials) >= 0.8
            && wilson_lower_bound(projected_critical, kQualificationTrials) >= 0.8,
    };
  }
  return curve;
}

bool print_vector(const Vector& vector) {
  const std::vector<PowerPoint> curve = simulate(vector);
  std::size_t minimum = 0;
  for (std::size_t count = 2; count <= kMaximumCheckedBrandCount; ++count) {
    if (curve[count].qualifies) {
      minimum = count;
      break;
    }
  }

  std::cout << "\n" << vector.name << "\n";
  if (minimum == 0) {
    std::cout << "  no qualifying size found through " << kMaximumCheckedBrandCount << " brands\n";
  } else {
    std::cout << "  minimum qualifying brand count: " << minimum << "\n";
  }
  std::cout << "  fixture power checkpoints (brand count: overall / critical)\n";
  for (const std::size_t count : vector.fixture_counts_to_report) {
    std::cout << "    " << count << ": " << curve[count].overall << " / "
              << curve[count].critical;
    if (curve[count].qualifies) std::cout << " (qualifies)";
    std::cout << "\n";
  }
  if (minimum == 0) {
    std::cerr << "ERROR: increase kMaximumCheckedBrandCount to include the minimum for this vector\n";
    return false;
  }
  return true;
}

void print_runtime() {
  std::cout << "Independent synthetic QLoRA preflight reference\n";
  std::cout << "C++ standard: " << __cplusplus << "\n";
  std::cout << "Compiler: " << __VERSION__ << "\n";
#ifdef __GLIBCXX__
  std::cout << "libstdc++ __GLIBCXX__: " << __GLIBCXX__ << "\n";
#elif defined(_LIBCPP_VERSION)
  std::cout << "libc++ version: " << _LIBCPP_VERSION << "\n";
#else
  std::cout << "C++ standard library: version macro unavailable\n";
#endif
  std::cout << "Reference draws/vector: " << kReferenceReplicates << "\n";
  std::cout << "Qualification trials: " << kQualificationTrials << "\n";
  std::cout << "Seed: " << kSeedBase << " + total synthetic case count\n";
  std::cout << "Projection: round(reference power * 5,000) successes; "
               "qualify when both 95% Wilson lower bounds are >= 0.80\n";
}

}  // namespace

int main() {
  std::cout << std::fixed << std::setprecision(6);
  print_runtime();
  bool all_vectors_qualified = true;
  for (const Vector& vector : make_vectors()) {
    all_vectors_qualified = print_vector(vector) && all_vectors_qualified;
  }
  return all_vectors_qualified ? 0 : 1;
}