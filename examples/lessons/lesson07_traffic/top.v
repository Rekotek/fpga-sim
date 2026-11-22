// Урок 7, практика 1: светофор — конечный автомат из пяти состояний.
// Красный 3 с → красный+жёлтый 1 с → зелёный 3 с → зелёный мигает 2 с → жёлтый 1 с → …
// S2 — синхронный сброс: светофор начинает с красного.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s2,   // кнопка S2, вывод 87: сброс
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // Полярность кнопки: «нажата = 1» — проверено на плате.
    localparam PRESSED = 1'b1;
    wire s2_in = (btn_s2 == PRESSED);

    // Синхронизатор кнопки сброса (урок 6). Антидребезг сбросу не нужен.
    reg s2_meta = 1'b0, s2_sync = 1'b0;

    always @(posedge clk) begin
        s2_meta <= s2_in;
        s2_sync <= s2_meta;
    end

    // Делитель: тик раз в секунду. В первой половине каждой секунды half = 1.
    localparam integer SEC_LAST = CLK_HZ - 1;        // 26 999 999
                                                     // < 2^25 = 33 554 432 → 25 бит
    localparam integer HALF     = CLK_HZ / 2;        // 13 500 000 тактов = 0,5 с
    reg  [24:0] div = 25'd0;
    wire        sec_tick = (div == SEC_LAST);
    wire        half     = (div < HALF);             // 1 — первые полсекунды

    always @(posedge clk) begin
        if (sec_tick || s2_sync) div <= 25'd0;   // сброс — секунда тоже с начала
        else                     div <= div + 1'b1;
    end

    // Состояния автомата: имена вместо чисел. Пять состояний — 3 бита.
    localparam [2:0] S_RED     = 3'd0,   // красный
                     S_RED_YEL = 3'd1,   // красный + жёлтый
                     S_GREEN   = 3'd2,   // зелёный
                     S_BLINK   = 3'd3,   // зелёный мигает
                     S_YELLOW  = 3'd4;   // жёлтый

    // Длительность фаз в секундах. Самая длинная — 3 с: таймеру sec хватает 2 бит.
    localparam [1:0] T_RED     = 2'd3,
                     T_RED_YEL = 2'd1,
                     T_GREEN   = 2'd3,
                     T_BLINK   = 2'd2,
                     T_YELLOW  = 2'd1;

    reg  [2:0] state = S_RED;   // регистр состояния — память автомата
    reg  [2:0] next;            // следующее состояние — провод из always @(*)
    reg  [1:0] sec = 2'd0;      // сколько секунд прошло в текущей фазе
    reg  [1:0] dur;             // сколько секунд длится текущая фаза
    reg  [2:0] light;           // {зелёный, жёлтый, красный}, 1 = горит

    // Выходы автомата: что горит и сколько длится фаза.
    always @(*) begin
        case (state)
            S_RED:     begin light = 3'b001;           dur = T_RED;     end
            S_RED_YEL: begin light = 3'b011;           dur = T_RED_YEL; end
            S_GREEN:   begin light = 3'b100;           dur = T_GREEN;   end
            S_BLINK:   begin light = {half, 2'b00};    dur = T_BLINK;   end
            S_YELLOW:  begin light = 3'b010;           dur = T_YELLOW;  end
            default:   begin light = 3'b001;           dur = T_RED;     end
        endcase
    end

    wire phase_end = sec_tick && (sec == dur - 1'b1);   // последняя секунда фазы прошла

    // Логика переходов: куда идём из каждого состояния.
    always @(*) begin
        next = state;                       // по умолчанию остаёмся на месте
        case (state)
            S_RED:     if (phase_end) next = S_RED_YEL;
            S_RED_YEL: if (phase_end) next = S_GREEN;
            S_GREEN:   if (phase_end) next = S_BLINK;
            S_BLINK:   if (phase_end) next = S_YELLOW;
            S_YELLOW:  if (phase_end) next = S_RED;
            default:   next = S_RED;        // 5, 6, 7 — чужие значения: на красный
        endcase
    end

    // Регистр состояния и таймер фазы. Сброс главнее.
    always @(posedge clk) begin
        if (s2_sync) begin
            state <= S_RED;
            sec   <= 2'd0;
        end else begin
            state <= next;
            if (next != state) sec <= 2'd0;          // новая фаза — таймер с нуля
            else if (sec_tick) sec <= sec + 1'b1;
        end
    end

    // LED0 — красный, LED1 — жёлтый, LED2 — зелёный; LED3..LED5 погашены.
    assign led = ~{3'b000, light};
endmodule
