package com.seatly.desk

import io.micronaut.serde.annotation.Serdeable
import jakarta.inject.Singleton
import jakarta.transaction.Transactional
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

@Singleton
open class DeskManager(
  private val deskRepository: DeskRepository,
  private val bookingRepository: BookingRepository,
) {
  fun createDesk(command: CreateDeskCommand): DeskDto {
    val desk =
      Desk(
        name = command.name,
        location = command.location,
      )

    val savedDesk = deskRepository.save(desk)
    return DeskDto.from(savedDesk)
  }

  fun listDesks(): List<DeskDto> = deskRepository.findAll().map { DeskDto.from(it) }

  fun listDeskAvailability(
    deskId: Long,
    startAt: LocalDateTime,
    endAt: LocalDateTime,
  ): List<AvailabilityDto> {
    require(!endAt.isBefore(startAt)) {
      "endAt must not be before startAt"
    }

    val normalizedRequestedStart = startAt.truncatedTo(ChronoUnit.MINUTES)
    val normalizedRequestedEnd = endAt.truncatedTo(ChronoUnit.MINUTES)

    val windowStart = normalizedRequestedStart.roundDownToHalfHour()
    val windowEnd = normalizedRequestedEnd.roundUpToHalfHour()

    if (!windowStart.isBefore(windowEnd)) {
      return emptyList()
    }

    val bookings =
      bookingRepository.findOverlappingBookings(
        deskId = deskId,
        startAt = windowStart,
        endAt = windowEnd,
      )

    val slots = mutableListOf<AvailabilityDto>()
    var slotStart = windowStart
    val slotMinutes = 30L

    while (slotStart.isBefore(windowEnd)) {
      val slotEnd = slotStart.plusMinutes(slotMinutes)

      val isBooked =
        bookings.any { booking ->
          booking.startAt.isBefore(slotEnd) && booking.endAt.isAfter(slotStart)
        }

      val status =
        if (isBooked) AvailabilityStatus.BOOKED else AvailabilityStatus.AVAILABLE

      slots.add(
        AvailabilityDto(
          startAt = slotStart,
          endAt = slotEnd,
          status = status,
        ),
      )

      slotStart = slotEnd
    }

    return slots
  }

  // Expand + validate + conflict-check the full series, then save atomically.
  @Transactional
  open fun createBooking(command: CreateBookingCommand): BookingCreationResultDto {
    val generatedOccurrences = command.generateOccurrences()
    validateGeneratedOccurrences(generatedOccurrences)
    // Validate the whole series before saving so recurring requests are
    // all-or-nothing instead of partially creating some weeks.
    bookingRepository.validateNoConflictingOccurrences(
      deskId = command.deskId,
      occurrences = generatedOccurrences,
    )

    val savedBookings =
      generatedOccurrences.map { occurrence ->
        bookingRepository.save(
          Booking(
            deskId = command.deskId,
            userId = command.userId,
            startAt = occurrence.startAt,
            endAt = occurrence.endAt,
          ),
        )
      }

    val savedBookingDtos = savedBookings.map { BookingDto.from(it) }

    return BookingCreationResultDto(
      primaryBooking = savedBookingDtos.first(),
      createdCount = savedBookingDtos.size,
      recurrenceType = command.recurrenceType,
      bookings = savedBookingDtos,
    )
  }
}

private data class BookingOccurrence(
  val startAt: LocalDateTime,
  val endAt: LocalDateTime,
)

private fun CreateBookingCommand.generateOccurrences(): List<BookingOccurrence> {
  validateRecurrenceRequest()

  val normalizedStart = startAt.truncatedTo(ChronoUnit.MINUTES)
  val normalizedEnd = endAt.truncatedTo(ChronoUnit.MINUTES)

  return when (recurrenceType) {
    null ->
      listOf(
        BookingOccurrence(
          startAt = normalizedStart,
          endAt = normalizedEnd,
        ),
      )
    // Weekly recurrence is expanded server-side so later steps can validate and
    // persist each generated booking consistently.
    BookingRecurrenceType.WEEKLY -> {
      val totalOccurrences = occurrences ?: 1

      (0 until totalOccurrences).map { occurrenceIndex ->
        BookingOccurrence(
          startAt = normalizedStart.plusWeeks(occurrenceIndex.toLong()),
          endAt = normalizedEnd.plusWeeks(occurrenceIndex.toLong()),
        )
      }
    }
  }
}

private fun CreateBookingCommand.validateRecurrenceRequest() {
  require(startAt.isBefore(endAt)) {
    "startAt must be before endAt"
  }

  when (recurrenceType) {
    null ->
      require(occurrences == null) {
        "occurrences can only be used with a recurrenceType"
      }
    // The enum already constrains supported recurrence values, so this branch
    // only needs to enforce the rest of the recurring input contract.
    BookingRecurrenceType.WEEKLY -> {
      requireNotNull(occurrences) {
        "occurrences is required for weekly recurring bookings"
      }

      require(occurrences >= 1) {
        "occurrences must be at least 1"
      }
    }
  }
}

private fun validateGeneratedOccurrences(occurrences: List<BookingOccurrence>) {
  require(occurrences.isNotEmpty()) {
    "Booking request must generate at least one occurrence"
  }

  // Re-check the expanded series so later steps can safely validate/save each
  // generated booking without repeating this shape validation.
  require(occurrences.all { it.startAt.isBefore(it.endAt) }) {
    "Each booking occurrence must have startAt before endAt"
  }
}

private fun BookingRepository.validateNoConflictingOccurrences(
  deskId: Long,
  occurrences: List<BookingOccurrence>,
) {
  // Check the whole generated series up front so a recurring request cannot
  // partially succeed once multi-row persistence is enabled.
  val hasConflict =
    occurrences.any { occurrence ->
      existsOverlappingBooking(
        deskId = deskId,
        startAt = occurrence.startAt,
        endAt = occurrence.endAt,
      )
    }

  if (hasConflict) {
    throw BookingConflictException()
  }
}

private fun LocalDateTime.roundDownToHalfHour(): LocalDateTime {
  val minute = if (this.minute < 30) 0 else 30
  return this
    .withMinute(minute)
    .withSecond(0)
    .withNano(0)
}

private fun LocalDateTime.roundUpToHalfHour(): LocalDateTime {
  val needsIncrement = this.minute % 30 != 0 || this.second != 0 || this.nano != 0
  val base =
    if (needsIncrement) this.plusMinutes(30 - (this.minute % 30).toLong()) else this
  val minute = if (base.minute < 30) 0 else 30
  return base
    .withMinute(minute)
    .withSecond(0)
    .withNano(0)
}

data class CreateDeskCommand(
  val name: String,
  val location: String?,
)

data class DeskDto(
  val id: Long,
  val name: String,
  val location: String?,
) {
  companion object {
    fun from(desk: Desk): DeskDto =
      DeskDto(
        id = desk.id!!,
        name = desk.name,
        location = desk.location,
      )
  }
}

data class AvailabilityDto(
  val startAt: LocalDateTime,
  val endAt: LocalDateTime,
  val status: AvailabilityStatus,
)

data class CreateBookingCommand(
  val deskId: Long,
  val userId: Long,
  val startAt: LocalDateTime,
  val endAt: LocalDateTime,
  // Null = "existing one-off booking flow".
  val recurrenceType: BookingRecurrenceType? = null,
  // One request into multiple weekly bookings.
  val occurrences: Int? = null,
)

@Serdeable
enum class BookingRecurrenceType {
  // Weekly recurrence only.
  WEEKLY,
}

class BookingConflictException : RuntimeException("Desk is already booked for the given time range")

data class BookingDto(
  val id: Long,
  val deskId: Long,
  val userId: Long,
  val startAt: LocalDateTime,
  val endAt: LocalDateTime,
) {
  companion object {
    fun from(booking: Booking): BookingDto =
      BookingDto(
        id = booking.id!!,
        deskId = booking.deskId,
        userId = booking.userId,
        startAt = booking.startAt,
        endAt = booking.endAt,
      )
  }
}

data class BookingCreationResultDto(
  // Keeps the existing one-booking fields available in the API response.
  val primaryBooking: BookingDto,
  val createdCount: Int,
  val recurrenceType: BookingRecurrenceType?,
  // Includes every saved occurrence so recurring creates are explicit.
  val bookings: List<BookingDto>,
)
