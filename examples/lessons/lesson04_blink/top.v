// Урок 4: blink. LED0 мигает раз в секунду: 0,5 с горит, 0,5 с не горит.
// Схема: 24 триггера счётчика + сумматор «+1» + сравнение + 1 триггер state.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire clk,     // 27 МГц, вывод 4
    output wire led0     // LED0, вывод 15, горит при 0
);
    // 0,5 с = CLK_HZ / 2 тактов; считаем от 0, поэтому до CLK_HZ / 2 - 1.
    localparam integer HALF = CLK_HZ / 2 - 1;   // 13 499 999 при 27 МГц

    // 13 499 999 < 2^24 = 16 777 216, значит, хватает 24 бит.
    reg [23:0] cnt   = 24'd0;   // счётчик тактов: 24 триггера
    reg        state = 1'b0;    // 1 = светодиод должен гореть

    always @(posedge clk) begin
        if (cnt == HALF) begin
            cnt   <= 24'd0;     // досчитали: начинаем сначала...
            state <= ~state;    // ...и переключаем светодиод
        end else begin
            cnt <= cnt + 1'b1;  // иначе прибавляем 1
        end
    end

    assign led0 = ~state;       // светодиод горит по нулю
endmodule
